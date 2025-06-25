// rollup.config.js
import resolve  from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import postcss  from 'rollup-plugin-postcss';

export default [
  // — Bundle JS into an IIFE for <script> tags —
  {
    input:  'public/client.js',
    output: {
      file:   'dist/beatchat.min.js',
      format: 'iife',
      name:   'BeatChatWidget'
    },
    plugins: [
      resolve(),    // find node_modules imports
      commonjs(),   // convert CJS → ESM
      terser()      // minify JS
    ]
  },

  // — Bundle & minify CSS into a single file —
  {
    input:  'public/styles.css',
    output: {
      file: 'dist/beatchat.min.css'
    },
    plugins: [
      postcss({
        extract:  true,  // output to its own .css file
        minimize: true   // minify CSS
      })
    ]
  }
];