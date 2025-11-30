import { useEffect, useState } from 'react';
import { api } from './Components/api';
import './App.css';

function App() {
  const [pools, setPools] = useState([]);
  const [positions, setPositions] = useState([]);
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [owner, setOwner] = useState('Ritik');

  const [createPoolForm, setCreatePoolForm] = useState({
    tokenA: 'USDT',
    tokenB: 'USDC',
    feeTier: 0.003,
    type: 'constant'
  });

  const [addLiqForm, setAddLiqForm] = useState({
    amountA: '',
    amountB: '',
    positionId: ''
  });

  const [swapForm, setSwapForm] = useState({
    inputToken: 'tokenA',
    inputAmount: '',
    minOutput: ''
  });

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const loadPools = async () => {
    const data = await api.getPools();
    setPools(data.pools);
    if (!selectedPoolId && data.pools.length > 0) {
      setSelectedPoolId(data.pools[0]._id);
    }
  };

  const loadPositions = async () => {
    const data = await api.getPositions(owner);
    setPositions(data.positions);
  };

  useEffect(() => {
    (async () => {
      await loadPools();
      await loadPositions();
    })();
  }, [owner]);

  const selectedPool = pools.find((p) => p._id === selectedPoolId);

  const handleCreatePool = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setMessage('');
      const payload = {
        tokenA: createPoolForm.tokenA,
        tokenB: createPoolForm.tokenB,
        feeTier: Number(createPoolForm.feeTier),
        type: createPoolForm.type
      };
      await api.createPool(payload);
      await loadPools();
      setMessage('Pool created successfully');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLiquidity = async (e) => {
    e.preventDefault();
    if (!selectedPoolId) return;
    try {
      setLoading(true);
      setMessage('');
      const payload = {
        amountA: Number(addLiqForm.amountA),
        amountB: Number(addLiqForm.amountB),
        owner,
        positionId: addLiqForm.positionId || undefined
      };
      await api.addLiquidity(selectedPoolId, payload);
      await loadPools();
      await loadPositions();
      setMessage('Liquidity added');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleQuoteSwap = async () => {
    if (!selectedPoolId) return;
    try {
      setLoading(true);
      setMessage('');
      const pool = selectedPool;
      const inputTokenSymbol =
        swapForm.inputToken === 'tokenA' ? pool.tokenA : pool.tokenB;

      const data = await api.quoteSwap(selectedPoolId, {
        inputToken: inputTokenSymbol,
        inputAmount: Number(swapForm.inputAmount)
      });
      setQuote(data.quote);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSwap = async (e) => {
    e.preventDefault();
    if (!selectedPoolId) return;
    try {
      setLoading(true);
      setMessage('');
      const pool = selectedPool;
      const inputTokenSymbol =
        swapForm.inputToken === 'tokenA' ? pool.tokenA : pool.tokenB;

      const data = await api.swap(selectedPoolId, {
        inputToken: inputTokenSymbol,
        inputAmount: Number(swapForm.inputAmount),
        minOutput: swapForm.minOutput ? Number(swapForm.minOutput) : undefined,
        deadlineMs: Date.now() + 60 * 1000
      });
      setMessage(
        `Swapped, got output: ${data.outputAmount.toFixed(6)} (price impact ${(data.priceImpact * 100).toFixed(4)}%)`
      );
      await loadPools();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAllLiquidity = async (positionId) => {
    try {
      setLoading(true);
      setMessage('');
      await api.removeLiquidity(positionId, {});
      await loadPools();
      await loadPositions();
      setMessage('Removed all liquidity from position');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimFees = async (positionId) => {
    try {
      setLoading(true);
      setMessage('');
      const res = await api.claimFees(positionId);
      const f = res.claimedFees;
      setMessage(`Claimed fees: tokenA=${f.tokenA.toFixed(6)} tokenB=${f.tokenB.toFixed(6)}`);
      await loadPools();
      await loadPositions();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <h1 className="app-title">AMM </h1>

      <div className="owner-box">
        <label>
          Current owner:
         
        </label><br/>
         <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
      </div><br/>

      {message && (
        <div className={`msg-box ${loading ? 'loading' : ''}`}>
          {loading ? ' Loading... ' : ''} {message}
        </div>
      )}

      <div className="grid-layout">
        <div>
          <section className="card">
            <h2>Create Pool</h2>
            <form onSubmit={handleCreatePool} className="form">
              <label>Token A: <input value={createPoolForm.tokenA} onChange={(e) => setCreatePoolForm(f => ({ ...f, tokenA: e.target.value }))} /></label>
              <label>Token B: <input value={createPoolForm.tokenB} onChange={(e) => setCreatePoolForm(f => ({ ...f, tokenB: e.target.value }))} /></label>
              <label>Fee tier: <input type="number" step="0.0001" value={createPoolForm.feeTier} onChange={(e) => setCreatePoolForm(f => ({ ...f, feeTier: e.target.value }))} /></label>
              <label>Type:<br/>
                <select value={createPoolForm.type} onChange={(e) => setCreatePoolForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="constant">Constant Product</option>
                  <option value="stable">Stable (A coeff.)</option>
                </select>
              </label>
              <button className="btn-primary" type="submit" disabled={loading}>Create Pool</button>
            </form>
          </section>

          <section className="card">
            <h2>Pools</h2>
            {pools.map((p) => (
              <div
                key={p._id}
                className={`pool-card ${selectedPoolId === p._id ? 'active' : ''}`}
                onClick={() => setSelectedPoolId(p._id)}
              >
                <strong>{p.tokenA}/{p.tokenB}</strong> (fee: {p.feeTier}, type: {p.type})
                <br />Reserves: A={p.reserveA.toFixed(4)} B={p.reserveB.toFixed(4)}
                <br />LP supply: {p.lpTotalSupply.toFixed(4)}
              </div>
            ))}
          </section>

          <section className="card">
            <h2>Add Liquidity</h2>
            {selectedPool ? (
              <form onSubmit={handleAddLiquidity} className="form">
                <label>Amount {selectedPool.tokenA}: <input type="number" step="0.000001" value={addLiqForm.amountA} onChange={(e) => setAddLiqForm(f => ({ ...f, amountA: e.target.value }))} /></label>
                <label>Amount {selectedPool.tokenB}: <input type="number" step="0.000001" value={addLiqForm.amountB} onChange={(e) => setAddLiqForm(f => ({ ...f, amountB: e.target.value }))} /></label>
                <label>Existing Position ID: <input value={addLiqForm.positionId} onChange={(e) => setAddLiqForm(f => ({ ...f, positionId: e.target.value }))} /></label>
                <button className="btn-primary" disabled={loading}>Add Liquidity</button>
              </form>
            ) : <p>No pool selected.</p>}
          </section>
        </div>

        <div>
          <section className="card">
            <h2>Swap</h2>
            {selectedPool ? (
              <form className="form" onSubmit={handleSwap}>
                <label>Input token:
                  <select value={swapForm.inputToken} onChange={(e) => setSwapForm(f => ({ ...f, inputToken: e.target.value }))}>
                    <option value="tokenA">{selectedPool.tokenA}</option>
                    <option value="tokenB">{selectedPool.tokenB}</option>
                  </select>
                </label>
                <label>Input amount: <input type="number" value={swapForm.inputAmount} onChange={(e) => setSwapForm(f => ({ ...f, inputAmount: e.target.value }))} /></label>
                <label>Min output: <input type="number" value={swapForm.minOutput} onChange={(e) => setSwapForm(f => ({ ...f, minOutput: e.target.value }))} /></label>

                <div className="flex center">
                  <button type="button" className="btn-secondary" onClick={handleQuoteSwap}>Get Quote</button>
                  <button className="btn-primary" disabled={loading}>Swap</button>
                </div>

                {quote && (
                  <p className="quote-box">
                    Output ≈ {quote.outputAmount.toFixed(6)}  
                    Price Impact ≈ {(quote.priceImpact * 100).toFixed(4)}%
                  </p>
                )}
              </form>
            ) : <p>No pool selected.</p>}
          </section>

          <section className="card">
            <h2>LP Positions (owner: {owner})</h2>
            {positions.map((pos) => {
              const pool = pools.find((p) => String(p._id) === String(pos.poolId));
              return (
                <div key={pos._id} className="position-card">
                  <strong>Position #{pos._id.slice(-6)} ({pool?.tokenA}/{pool?.tokenB})</strong>
                  <p>LP Amount: {pos.lpAmount.toFixed(6)}</p>
                  <p>Fees: {pos.feesTokenA.toFixed(6)} / {pos.feesTokenB.toFixed(6)}</p>
                  <div className="flex center">
                    <button className="btn-danger" onClick={() => handleRemoveAllLiquidity(pos._id)}>Remove All</button>
                    <button className="btn-secondary" onClick={() => handleClaimFees(pos._id)}>Claim Fees</button>
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
