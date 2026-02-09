import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    external: [
        '@prisma/client',
        'ethers'
    ],
    noExternal: [
        'ajv',
        'ajv-formats'
    ]
});
