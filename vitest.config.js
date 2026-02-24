/** Vitest config — Node pool for unit tests (SSRF, state machine, presigned validation) */
export default {
    test: {
        environment: 'node',
        include: ['tests/**/*.test.js', 'test/**/*.test.js', 'src/**/*.test.js'],
        globals: false,
    },
};
