// Plain-English explainers for the Stocks card (docs/superpowers/specs/2026-11-16-stocks-explainers-design.md):
// what each lens, verdict and bit of jargon means, what we look for, and what George's own reading
// says. Fixed text and a little arithmetic on the reason line: no network, no AI, never advice.

const NO_DATA = 'No reading: no data yet, or it doesn’t apply (a fund has no profits of its own).';

const LENS = {
  trend: {
    title: 'Trend',
    what: 'How the share price has moved over the past year.',
    look: 'Shares that have risen over a year tend to keep going for a while, and a long fall often means the market has spotted a problem. You want the trend to back up your reason for owning it.',
    scale: { green: 'Up 10% or more over the year.', amber: 'Within 10% either way: no clear direction.', red: 'Down 10% or more over the year.' },
  },
  price: {
    title: 'Price',
    what: 'Whether the share is cheap or dear compared with its own recent past. It uses the P/E: how many pounds (or dollars) you pay for each £1 of the company’s yearly profit.',
    look: 'A P/E lower than this company’s usual means you are paying less than people normally do for its profits. It says nothing about whether the company is any good: that’s what the other lenses are for.',
    scale: { green: 'At or below its usual P/E, or up to 20% above it.', amber: '20–50% above its usual P/E: getting stretched.', red: '50% or more above its usual P/E: expensive for this company.' },
  },
  health: {
    title: 'Health',
    what: 'How strong the business itself is: does it keep a big share of each sale as profit, steadily, and earn a good return on the money put into it?',
    look: 'Four things: a gross margin of 40% or more (it can charge well above what things cost it), an operating margin that is steady or rising, a return on capital of 10% or more, and not too much debt.',
    scale: { green: 'Passes all four.', amber: 'Misses at least one: the reason says which.', red: 'Losing money, or carrying more than four years of profit in debt.' },
  },
  expectations: {
    title: 'Expectations',
    what: 'How the company is doing against what it, and the people who follow it, said it would do: results beating or missing forecasts, and guidance going up or down.',
    look: 'Share prices move on surprises. Beating forecasts and raising guidance is good news; missing them or cutting guidance is the warning sign. This one is Claude’s reading of the news, so it is softer than the others.',
    scale: { green: 'Beating forecasts or raising guidance.', amber: 'A mix of good and bad news.', red: 'Missing forecasts or cutting guidance.' },
  },
  risk: {
    title: 'Risk',
    what: 'How far the price is below its high of the past year, compared with how far this share usually dips.',
    look: 'Every share dips. What matters is a dip that is bigger than normal for that share: it can mean something has changed, or, if nothing has, that it’s on sale.',
    scale: { green: 'A normal dip for this share, or at its high.', amber: 'About one and a half times its usual dip.', red: 'Two and a half times its usual dip or more.' },
  },
};

export const LENS_KEYS = Object.keys(LENS);

const num = (re, text) => { const m = re.exec(text ?? ''); return m ? Number(m[1]) : null; };

// "Yours": the reading itself, in words.
function yours(key, dot, reason, tier) {
  if (dot === 'grey') return tier === 'fund' || tier === 'market' ? 'This is a fund, so it has no profits or results of its own to judge: only trend and risk apply.' : 'There is no reading for this yet.';
  if (key === 'trend') {
    const up = num(/Up (\d+)%/, reason); const down = num(/Down (\d+)%/, reason);
    if (up != null) return `It is up ${up}% over the year${dot === 'green' ? ': the market has been agreeing with you.' : ', not enough to call it a clear trend.'}`;
    if (down != null) return `It is down ${down}% over the year${dot === 'red' ? ': the market has been going against this one. Worth asking whether it knows something, or the share is just out of favour.' : ', not enough to call it a clear trend.'}`;
    return 'Roughly flat over the year: the market hasn’t made up its mind.';
  }
  if (key === 'price') {
    const pe = num(/P\/E (\d+)/, reason); const med = num(/median of (\d+)/, reason);
    if (pe != null && med != null) {
      const side = pe < med ? `less than the ${med} times it has usually cost over the last two years` : pe > med ? `more than the ${med} times it has usually cost over the last two years` : 'about what it has usually cost';
      return `Its price is about ${pe} times its yearly profit: ${side}.${dot === 'green' ? ' Cheap or fair for this company.' : dot === 'amber' ? ' A bit stretched for this company.' : ' Expensive for this company.'}`;
    }
    if (pe != null) return `Its price is about ${pe} times its yearly profit.`;
  }
  const verdict = { green: 'Green: this one backs up your reason for owning it.', amber: 'Amber: some of this backs you up, some doesn’t.', red: 'Red: this one is going against your reason for owning it.' }[dot];
  return reason ? `${verdict} In short: ${reason.replace(/\s*\((SEC accounts|[^)]*soft)\)\s*$/, '')}.`.replace(/\.\.$/, '.') : verdict;
}

export function lensExplainer(key, { dot, reason } = {}, tier = null) {
  const l = LENS[key];
  if (!l) return null;
  return {
    title: l.title,
    what: l.what,
    look: l.look,
    scale: [['green', l.scale.green], ['amber', l.scale.amber], ['red', l.scale.red], ['grey', NO_DATA]],
    yours: yours(key, dot ?? 'grey', reason ?? '', tier),
  };
}

// Jargon that turns up in reasons and notes. Longest names first, so "operating margin" wins over "margin".
const TERMS = {
  'forward earnings': { title: 'Forward earnings', what: 'The profit people expect a company to make over the next year, rather than what it made last year. A P/E on forward earnings is a guess about the future.' },
  'return on capital': { title: 'Return on capital', what: 'How much profit (after tax) the company makes on all the money tied up in it, from shareholders and lenders. 10% or more a year is good; it means the business turns money into more money well.' },
  'operating margin': { title: 'Operating margin', what: 'What is left of each £1 of sales after paying for the product, staff, offices and research: the profit from running the business. Steady or rising is what you want.' },
  'gross margin': { title: 'Gross margin', what: 'What is left of each £1 of sales after paying just for the product itself. A high gross margin (40%+) means customers pay well above what things cost to make: a sign of pricing power.' },
  'net margin': { title: 'Net margin', what: 'What is left of each £1 of sales after every cost, including interest and tax: the final profit. Very high net margins are rare and a sign of a dominant business.' },
  'free cash flow': { title: 'Free cash flow', what: 'The cash a business actually has left at the end of a period after paying its running costs and its investment. It pays for dividends, buybacks and paying off debt.' },
  'buyback': { title: 'Buyback', what: 'The company buying its own shares. Fewer shares means each one you own is a slightly bigger slice of the business.' },
  'backlog': { title: 'Backlog', what: 'Orders signed but not yet delivered: future sales the company can already count on, common in defence and engineering.' },
  'guidance': { title: 'Guidance', what: 'What the company itself says it expects to make this year. Raising it is a sign of confidence; cutting it usually hits the share price.' },
  'capex': { title: 'Capex', what: 'Capital expenditure: money spent on long-lasting things like factories, data centres and machines. Big capex can pay off later but eats cash now.' },
  'median': { title: 'Median', what: 'The middle value: half the time it was above this, half below. Used here as “its usual level”.' },
  'P/E': { title: 'P/E (price to earnings)', what: 'The share price divided by the profit per share over the last year: how much you pay for each £1 of yearly profit. 20 means you pay £20 for £1 of profit a year. Lower is cheaper, but fast-growing companies usually cost more.' },
  'RSI': { title: 'RSI (relative strength index)', what: 'A 0–100 score of how hard a share has been bought or sold over the last couple of weeks. Above 70 it has risen fast and may pause; below 30 it has fallen fast. A short-term gauge only.' },
};
const TERM_NAMES = Object.keys(TERMS).sort((a, b) => b.length - a.length);
const TERM_RE = new RegExp(`(${TERM_NAMES.map((t) => t.replace(/[/]/g, '\\/')).join('|')})`, 'gi');

export function termExplainer(term) {
  const k = TERM_NAMES.find((t) => t.toLowerCase() === String(term).toLowerCase());
  return k ? { key: k, ...TERMS[k] } : null;
}

// A reason split into plain text and tappable terms: [{ text, term }] where term is a TERMS key or null.
export function splitTerms(text) {
  const out = [];
  let last = 0;
  for (const m of String(text ?? '').matchAll(TERM_RE)) {
    const before = text.slice(last, m.index);
    // Whole words only ("P/E" inside "P/E 21" is fine; "capexes" isn't a word we write).
    if (/\w$/.test(before) || /^\w/.test(text.slice(m.index + m[0].length))) continue;
    if (before) out.push({ text: before, term: null });
    out.push({ text: m[0], term: termExplainer(m[0]).key });
    last = m.index + m[0].length;
  }
  if (last < String(text ?? '').length) out.push({ text: text.slice(last), term: null });
  return out;
}

export function verdictExplainer(verdict, tier) {
  const fund = tier === 'fund' || tier === 'market';
  const how = fund
    ? 'For a fund only two lenses apply, trend and risk. Both green: agrees. Both red: disagrees. Anything else: mixed.'
    : 'Two or more red lenses (or trend and expectations both red) means the numbers disagree. Four or more green and no red means they agree. Anything in between is mixed.';
  const means = {
    agrees: 'The numbers back up your reason for owning it.',
    mixed: 'Some numbers back you up and some don’t. That is normal: most holdings are mixed most of the time.',
    disagrees: 'The numbers are going against your reason for owning it. It doesn’t mean sell: it means look at what changed and whether your reason still holds.',
  }[verdict] ?? (tier === 'pie' ? 'Pie funds are held for the cashback and aren’t judged.' : 'There aren’t enough numbers to judge it yet.');
  return {
    title: 'Agrees, mixed or disagrees',
    what: 'A one-line summary of the five lenses, measured against your reason for owning it (your thesis).',
    look: how,
    yours: means,
  };
}

export const ADD_EXPLAINER = {
  title: 'A moment to add?',
  what: 'Shown when Claude’s news check says your reason for owning it still holds, health and expectations aren’t red, and the price has dipped more than usual.',
  look: 'Buying more of something you believe in after an unusual dip is one way investors average down. It’s a question for you, never advice: only you know whether you have spare money and want more of this one.',
};
