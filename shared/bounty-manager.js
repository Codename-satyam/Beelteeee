(function () {
  'use strict';

  const drawBounties = async (match) => {
    try {
      const response = await fetch('../data/bounties.json', { cache: 'no-store' });
      const bounties = await response.json();
      const killerBounties = bounties.filter(b => b.side === 'killer' && b.enabled).sort(() => 0.5 - Math.random()).slice(0, 2);
      const survivorBounties = bounties.filter(b => b.side === 'survivor' && b.enabled).sort(() => 0.5 - Math.random()).slice(0, 2);

      return [...killerBounties, ...survivorBounties];
    } catch (e) {
      console.error('Bounty draw failed', e);
      return [];
    }
  };

  window.BountyManager = { drawBounties };
})();
