// Mini-IPIP scoring (config/mini_ipip.json): each trait is the mean of its 4
// items after reversing reverse-keyed ones (6 − x), rescaled to 0–1:
// (mean − 1) / 4. Same key as the IPIP-FFM scoring used for synthetic users.
const MINI = require('../config/mini_ipip.json');

const ITEMS = MINI.items;
const TRAITS = Object.keys(MINI.traits); // E A C N O

/** answers: array of 20 integers 1–5 in item order (n = 1..20). */
function scoreMiniIpip(answers) {
  if (!Array.isArray(answers) || answers.length !== ITEMS.length) {
    throw new RangeError(`Expected ${ITEMS.length} answers`);
  }
  const sums = Object.fromEntries(TRAITS.map(t => [t, []]));
  ITEMS.forEach((item, i) => {
    const x = answers[i];
    if (!Number.isInteger(x) || x < 1 || x > 5) throw new RangeError(`Answer ${i + 1} must be 1–5`);
    sums[item.trait].push(item.reverse ? 6 - x : x);
  });
  const out = {};
  for (const t of ['O', 'C', 'E', 'A', 'N']) {
    const v = sums[t];
    out[t] = Math.round(((v.reduce((a, b) => a + b, 0) / v.length - 1) / 4) * 10000) / 10000;
  }
  return out;
}

// Items for the questionnaire UI (no keys exposed; they're public anyway).
const publicItems = () => ITEMS.map(i => ({ n: i.n, text: i.text }));

module.exports = { scoreMiniIpip, publicItems, scale: MINI.scale, citation: MINI.citation };
