// rollup.config.js
import resolve  from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser }    from 'rollup-plugin-terser';
import postcss  from 'rollup-plugin-postcss';

export default [
  // —————————————————————— JS Bundle ——————————————————————
  {
    input:  'public/client.js',
    output: {
      file:   'docs/beatchat.min.js',
      format: 'iife',
      name:   'BeatChatWidget'
    },
    plugins: [
      resolve(),
      commonjs(),
      terser()
    ]
  },

  // ————————————————————— CSS Bundle —————————————————————
  {
    input:  'public/styles.css',
    output: {
      file: 'docs/beatchat.min.css'  // this value is ignored for JS, but PostCSS will write the CSS here
    },
    plugins: [
      postcss({
        extract:  true,    // writes to docs/beatchat.min.css
        minimize: true
      })
    ]
  }
];
