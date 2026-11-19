import fs from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {babel} from "@rollup/plugin-babel";
import {nodeResolve} from "@rollup/plugin-node-resolve";
import {parse} from "acorn";
import less from "less";
import {rollup} from "rollup";
import {minify} from "terser";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const {version, license} = JSON.parse(await fs.readFile(path.join(DIR, '..', 'package.json'), 'utf8'));

// /*! сохраняют terser и less
const getBanner = name => `/*!
 * ${name} v${version}
 * Copyright (c) ${new Date().getFullYear()} Jaxima LLC
 * @license ${license}
 * @link https://github.com/Xiomb/xiomb
 */
`;

const XSOCKET_DIR = path.dirname(createRequire(import.meta.url).resolve('xsocket/package.json'));

const LEGACY_TARGET_LIST = ['ie >= 10', 'safari >= 6', 'ios_saf >= 6', 'android >= 4.4', 'defaults'];

// современная сборка берёт ESM xsocket, старая — его ES5 UMD
const xSocketPlugin = isLegacy => ({
    name: 'xsocket',
    resolveId: id => id === 'xsocket' ? (isLegacy ? '\0xsocket' : path.join(XSOCKET_DIR, 'xSocket.mjs')) : null,
    load: async id => id === '\0xsocket'
        ? `var exports = {}, module = {exports: exports};\n${await fs.readFile(path.join(XSOCKET_DIR, 'xSocket.js'), 'utf8')}\nexport default module.exports;`
        : null,
});

const write = (file, data) => fs.writeFile(path.join(DIR, file), data);

const checkES5 = (file, code) => {
    try {
        parse(code, {ecmaVersion: 5});
    } catch (e) {
        throw new Error(`Not ES5: ${file} (${e.message})`);
    }
};

const bundle = async (input, format, isLegacy) => {
    const build = await rollup({
        input: path.join(DIR, input),
        plugins: [
            xSocketPlugin(isLegacy),
            nodeResolve({browser: true}),
            isLegacy && babel({
                babelHelpers: 'bundled',
                babelrc: false,
                configFile: false,
                include: path.join(DIR, 'src/**'),
                presets: [['@babel/preset-env', {targets: LEGACY_TARGET_LIST, loose: true, modules: false, exclude: ['transform-async-to-generator', 'transform-regenerator']}]],
                plugins: [['transform-async-to-promises', {inlineHelpers: true}]],
            }),
        ],
        onwarn: (warning, warn) => warning.code !== 'THIS_IS_UNDEFINED' && warn(warning),
    });
    const {output: [chunk]} = await build.generate({format, banner: getBanner('xiomb')});
    await build.close();
    return chunk.code;
};

const writeBundle = async (file, minFile, code, minifyOptions) => {
    await write(file, code);
    const minCode = await minify({[file]: code}, {...minifyOptions, sourceMap: {url: `${minFile}.map`}});
    await write(minFile, minCode.code);
    await write(`${minFile}.map`, minCode.map);
    return minCode.code;
};

const moduleCode = await bundle('src/index.js', 'es', false);
await writeBundle('xiomb.mjs', 'xiomb.min.mjs', moduleCode, {module: true});

const legacyCode = await bundle('src/legacy.js', 'iife', true);
checkES5('xiomb.js', legacyCode);
checkES5('xiomb.min.js', await writeBundle('xiomb.js', 'xiomb.min.js', legacyCode, {ecma: 5, safari10: true}));

const lessFile = path.join(DIR, 'src/xiombPlayer.less');
const lessSource = getBanner('xiombPlayer') + await fs.readFile(lessFile, 'utf8');
const css = await less.render(lessSource, {filename: lessFile});
await write('xiombPlayer.css', css.css);
const minCss = await less.render(lessSource, {
    filename: lessFile,
    compress: true,
    sourceMap: {sourceMapURL: 'xiombPlayer.min.css.map', sourceMapBasepath: DIR, outputSourceFiles: true},
});
await write('xiombPlayer.min.css', minCss.css);
await write('xiombPlayer.min.css.map', minCss.map);
