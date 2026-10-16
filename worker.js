import { parentPort } from 'worker_threads';
import { STOP_LETTERS, transformPunctuation } from './peripherals';

export function generateFulltextIndex(inputString = '') {
    inputString = transformPunctuation(inputString);

    const words = inputString.split(/\s+/).filter(v => v);
    const searchArray = new Set();

    for (let i = 0; i < words.length; i++) {
        let currentTerm = '',
            wordCount = 0;

        for (let j = i; j < words.length; j++) {
            if (!STOP_LETTERS.has(words[j])) ++wordCount;

            if (wordCount < 10) {
                if (j !== i) currentTerm += ' ';
                for (let x = 0; x < words[j].length; x++) {
                    currentTerm += words[j][x];
                    if (!searchArray.has(currentTerm)) searchArray.add(currentTerm);
                }
            } else break;
        }
        currentTerm = undefined;
        wordCount = undefined;
    }

    return [...searchArray];
}

if (parentPort)
    parentPort.on('message', ({ input, session }) => {
        try {
            const indexes = generateFulltextIndex(input.text);
            parentPort.postMessage([{ indexes }, session]);
        } catch (error) {
            parentPort.postMessage([undefined, session, { error: `${error}` }]);
        }
    });
