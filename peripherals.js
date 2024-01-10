export const STOP_LETTERS = new Set('.,?!-_;()[]:+=^<>|/'.split(''));

export const DEFAULT_DB_URL = 'mongodb://127.0.0.1:27017';

export const transformPunctuation = (t = '') => t.toLowerCase().split('').map((v, i, a) =>
    (STOP_LETTERS.has(v) && i && a[i - 1] !== ' ') ? ` ${v}` : v
).join('');

// const joinArray = (t) => {
//     let s = 0;
//     for (let i = 0; i < t.length; i++) {
//         s += t[i].length;
//     }
//     return s;
// }