import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';

export default {
    input: ['index.js', 'worker.js'],
    plugins: [
        resolve(),
        babel({
            babelHelpers: 'bundled',
            presets: [
                ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
            ],
        }),
        terser(),
    ],
    output: [
        {
            dir: 'dist/esm',
            format: 'es',
            assetFileNames: '[name].[ext]'
        },
        {
            dir: 'dist/cjs',
            format: 'cjs',
            assetFileNames: '[name].[ext]'
        },
        // {
        //   file: 'dist/esm/index.min.js',
        //   format: 'es',
        // },
    ],
    external: ['mongodb', 'worker_threads', 'url', 'path', 'mongodb/lib/bson'], // Add other external dependencies
};