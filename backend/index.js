
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');



const app = express();
app.use(cors());
app.use(bodyParser.json());

const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('database connected'))
  .catch((err) => console.error('database connection error:', err));

//model

const poolSchema = new mongoose.Schema(
  {
    tokenA: { type: String, required: true },
    tokenB: { type: String, required: true },
    feeTier: { type: Number, default: 0.003 }, 
    type: { type: String, enum: ['constant', 'stable'], default: 'constant' },
    A: { type: Number, default: 50 }, 

    reserveA: { type: Number, default: 0 },
    reserveB: { type: Number, default: 0 },
    lpTotalSupply: { type: Number, default: 0 },

    accumulatedFeesA: { type: Number, default: 0 },
    accumulatedFeesB: { type: Number, default: 0 },
    protocolFeesA: { type: Number, default: 0 },
    protocolFeesB: { type: Number, default: 0 },

    protocolFeeShare: { type: Number, default: 0.1 } 
  },
  { timestamps: true }
);

const positionSchema = new mongoose.Schema(
  {
    poolId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pool', required: true },
    owner: { type: String, required: true },
    lpAmount: { type: Number, required: true },

    feesTokenA: { type: Number, default: 0 },
    feesTokenB: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Pool = mongoose.model('Pool', poolSchema);
const Position = mongoose.model('Position', positionSchema);

// logic

function toNumber(x) {
  if (typeof x === 'string') return Number(x);
  return x;
}

function enforceDeadline(deadlineMs) {
  if (!deadlineMs) return;
  const now = Date.now();
  if (now > deadlineMs) {
    throw new Error('Transaction deadline exceeded');
  }
}

function enforceMinOutput(actualOutput, minOutput) {
  if (minOutput === undefined || minOutput === null) return;
  if (actualOutput < minOutput) {
    throw new Error('Slippage too high: output below minimum');
  }
}

function initialLPTokens(amountA, amountB) {
  return Math.sqrt(amountA * amountB);
}

function addLiquidityToPool(pool, amountA, amountB) {
  amountA = toNumber(amountA);
  amountB = toNumber(amountB);

  if (amountA <= 0 || amountB <= 0) {
    throw new Error('Invalid liquidity amounts');
  }

  let lpToMint;
  if (pool.lpTotalSupply === 0) {
    lpToMint = initialLPTokens(amountA, amountB);
  } else {
    lpToMint = (amountA * pool.lpTotalSupply) / pool.reserveA;

    const expectedB = (amountA * pool.reserveB) / pool.reserveA;
    const tolerance = expectedB * 0.005; 
    if (Math.abs(expectedB - amountB) > tolerance) {
      throw new Error('Liquidity ratio out of tolerance');
    }
  }

  pool.reserveA += amountA;
  pool.reserveB += amountB;
  pool.lpTotalSupply += lpToMint;

  return lpToMint;
}

function removeLiquidityFromPool(pool, lpAmount) {
  lpAmount = toNumber(lpAmount);

  if (lpAmount <= 0 || lpAmount > pool.lpTotalSupply) {
    throw new Error('Invalid lp amount');
  }

  const amountA = (lpAmount * pool.reserveA) / pool.lpTotalSupply;
  const amountB = (lpAmount * pool.reserveB) / pool.lpTotalSupply;

  pool.reserveA -= amountA;
  pool.reserveB -= amountB;
  pool.lpTotalSupply -= lpAmount;

  return { amountA, amountB };
}

function quoteSwapOnPool(pool, inputToken, inputAmount) {
  inputAmount = toNumber(inputAmount);
  if (inputAmount <= 0) throw new Error('Invalid input amount');

  const fee = pool.feeTier;
  let reserveIn, reserveOut;

  if (inputToken === pool.tokenA) {
    reserveIn = pool.reserveA;
    reserveOut = pool.reserveB;
  } else if (inputToken === pool.tokenB) {
    reserveIn = pool.reserveB;
    reserveOut = pool.reserveA;
  } else {
    throw new Error('Invalid input token for this pool');
  }

  if (reserveIn <= 0 || reserveOut <= 0) {
    throw new Error('Insufficient liquidity');
  }

  const inputWithFee = inputAmount * (1 - fee);
  const newReserveIn = reserveIn + inputWithFee;
  const k = reserveIn * reserveOut;
  const newReserveOut = k / newReserveIn;
  const outputAmount = reserveOut - newReserveOut;

  const originalPrice = reserveOut / reserveIn;
  const newPrice = newReserveOut / newReserveIn;
  const priceImpact = Math.abs(newPrice - originalPrice) / originalPrice;

  const feeAmount = inputAmount * fee;

  return { outputAmount, priceImpact, inputWithFee, feeAmount };
}

function executeSwapOnPool(pool, inputToken, inputAmount, minOutput) {
  const { outputAmount, priceImpact, inputWithFee, feeAmount } = quoteSwapOnPool(
    pool,
    inputToken,
    inputAmount
  );

  enforceMinOutput(outputAmount, minOutput);

  const protocolShare = pool.protocolFeeShare || 0.1;
  const protocolCut = feeAmount * protocolShare;
  const lpCut = feeAmount - protocolCut;

  if (inputToken === pool.tokenA) {
    pool.reserveA += inputWithFee;
    pool.reserveB -= outputAmount;

    pool.accumulatedFeesA += lpCut;
    pool.protocolFeesA += protocolCut;
    pool.reserveA += lpCut;
  } else {
    pool.reserveB += inputWithFee;
    pool.reserveA -= outputAmount;

    pool.accumulatedFeesB += lpCut;
    pool.protocolFeesB += protocolCut;
    pool.reserveB += lpCut;
  }

  return { outputAmount, priceImpact };
}

async function claimFeesForPosition(pool, position) {
  if (pool.lpTotalSupply === 0) {
    return { tokenA: 0, tokenB: 0 };
  }

  const share = position.lpAmount / pool.lpTotalSupply;

  const claimableA = pool.accumulatedFeesA * share;
  const claimableB = pool.accumulatedFeesB * share;

  pool.accumulatedFeesA -= claimableA;
  pool.accumulatedFeesB -= claimableB;

  position.feesTokenA += claimableA;
  position.feesTokenB += claimableB;

  const fees = {
    tokenA: position.feesTokenA,
    tokenB: position.feesTokenB
  };

  position.feesTokenA = 0;
  position.feesTokenB = 0;

  await pool.save();
  await position.save();

  return fees;
}

// route

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'AMM backend  running' });
});



// Create pool
app.post('/pools', async (req, res) => {
  try {
    const { tokenA, tokenB, feeTier, type, A } = req.body;

    if (!tokenA || !tokenB || tokenA === tokenB) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid token pair ' });
    }

    const existing = await Pool.findOne({
      $or: [
        { tokenA, tokenB, feeTier },
        { tokenA: tokenB, tokenB: tokenA, feeTier }
      ]
    });

    if (existing) {
      return res
        .status(400)
        .json({ ok: false, error: 'Pool already exists ' });
    }

    const pool = await Pool.create({
      tokenA,
      tokenB,
      feeTier: feeTier ?? 0.003,
      type: type || 'constant',
      A: A || 50
    });

    res.json({ ok: true, pool });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// get pools
app.get('/pools', async (req, res) => {
  const pools = await Pool.find().sort({ createdAt: -1 });
  res.json({ ok: true, pools });
});

// Pool detail
app.get('/pools/:id', async (req, res) => {
  try {
    const pool = await Pool.findById(req.params.id);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });
    res.json({ ok: true, pool });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});



// Add liquidity 
app.post('/pools/:id/liquidity/add', async (req, res) => {
  try {
    const { amountA, amountB, owner, positionId } = req.body;
    const pool = await Pool.findById(req.params.id);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });

    let position;

    if (positionId) {
      position = await Position.findById(positionId);
      if (!position)
        return res.status(404).json({ ok: false, error: 'Position not found' });
      if (String(position.poolId) !== String(pool._id)) {
        return res
          .status(400)
          .json({ ok: false, error: 'Position does not belongs to this pool' });
      }
    }

    const lpMinted = addLiquidityToPool(pool, amountA, amountB);

    if (!position) {
      position = await Position.create({
        poolId: pool._id,
        owner: owner || 'anonymous',
        lpAmount: lpMinted
      });
    } else {
      position.lpAmount += lpMinted;
      await position.save();
    }

    await pool.save();

    res.json({
      ok: true,
      lpMinted,
      pool,
      position
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// del liquidity
app.post('/positions/:id/liquidity/remove', async (req, res) => {
  try {
    const { lpAmount } = req.body;
    const position = await Position.findById(req.params.id);
    if (!position)
      return res.status(404).json({ ok: false, error: 'Position not found' });

    const pool = await Pool.findById(position.poolId);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });

    const removeAmount = lpAmount ? toNumber(lpAmount) : position.lpAmount;
    if (removeAmount <= 0 || removeAmount > position.lpAmount) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid lp amount ' });
    }

    const { amountA, amountB } = removeLiquidityFromPool(pool, removeAmount);
    position.lpAmount -= removeAmount;

    if (position.lpAmount === 0) {
      await Position.deleteOne({ _id: position._id });
    } else {
      await position.save();
    }
    await pool.save();

    res.json({
      ok: true,
      withdrawn: { amountA, amountB },
      pool,
      position: position.lpAmount === 0 ? null : position
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// swap

app.post('/pools/:id/quote', async (req, res) => {
  try {
    const { inputToken, inputAmount } = req.body;
    const pool = await Pool.findById(req.params.id);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });

    const quote = quoteSwapOnPool(pool, inputToken, inputAmount);
    res.json({ ok: true, quote });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/pools/:id/swap', async (req, res) => {
  try {
    const { inputToken, inputAmount, minOutput, deadlineMs } = req.body;
    const pool = await Pool.findById(req.params.id);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });

    enforceDeadline(deadlineMs);

    const { outputAmount, priceImpact } = executeSwapOnPool(
      pool,
      inputToken,
      inputAmount,
      minOutput
    );

    await pool.save();

    res.json({ ok: true, outputAmount, priceImpact, pool });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});


// getting all positions 
app.get('/positions', async (req, res) => {
  const { owner } = req.query;
  const query = owner ? { owner } : {};
  const positions = await Position.find(query).sort({ createdAt: -1 });
  res.json({ ok: true, positions });
});

// get singl position
app.get('/positions/:id', async (req, res) => {
  try {
    const position = await Position.findById(req.params.id);
    if (!position)
      return res.status(404).json({ ok: false, error: 'Position not found' });
    res.json({ ok: true, position });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Claim fees
app.post('/positions/:id/claim-fees', async (req, res) => {
  try {
    const position = await Position.findById(req.params.id);
    if (!position)
      return res.status(404).json({ ok: false, error: 'Position not found' });

    const pool = await Pool.findById(position.poolId);
    if (!pool) return res.status(404).json({ ok: false, error: 'Pool not found' });

    const fees = await claimFeesForPosition(pool, position);

    res.json({ ok: true, claimedFees: fees, pool, position });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// server

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(` backend running on http://localhost:${PORT}`);
});
