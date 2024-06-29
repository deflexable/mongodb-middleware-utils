export const STOP_LETTERS = new Set('.,?!-_;()[]:+=^<>|/{}#$&%'.split(''));

export const transformPunctuation = (t = '') => t.toLowerCase().split('').map((v, i, a) =>
    (STOP_LETTERS.has(v) && i && a[i - 1] !== ' ') ? ` ${v}` : v
).join('');

export const Scope = {
    listeningFulltext: []
};