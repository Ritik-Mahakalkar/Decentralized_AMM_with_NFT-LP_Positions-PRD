
const API_BASE = 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

export const api = {
  getPools: () => request('/pools'),
  createPool: (payload) =>
    request('/pools', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  addLiquidity: (poolId, payload) =>
    request(`/pools/${poolId}/liquidity/add`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  quoteSwap: (poolId, payload) =>
    request(`/pools/${poolId}/quote`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  swap: (poolId, payload) =>
    request(`/pools/${poolId}/swap`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  getPositions: (owner) =>
    request('/positions' + (owner ? `?owner=${owner}` : '')),
  removeLiquidity: (positionId, payload) =>
    request(`/positions/${positionId}/liquidity/remove`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  claimFees: (positionId) =>
    request(`/positions/${positionId}/claim-fees`, {
      method: 'POST'
    })
};
