const path = require('path');
const { merge } = require('webpack-merge');

const common = require('./webpack.common');

module.exports = merge(common, {
    // In order for live reload to work we must use "web" as the target not "browserslist"
    target: process.env.WEBPACK_SERVE ? 'web' : 'browserslist',
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    module: {
        rules: [
            {
                test: /\.(js|jsx|ts|tsx)$/,
                exclude: /node_modules/,
                enforce: 'pre',
                use: ['source-map-loader']
            }
        ]
    },
    snapshot: {
        managedPaths: [path.resolve(__dirname, 'node_modules')]
    },
    watchOptions: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        poll: 1000,
        aggregateTimeout: 300
    },
    devServer: {
        allowedHosts: 'all',
        static: false,
        compress: true,
        hot: true,
        watchFiles: {
            paths: ['src/**/*'],
            options: {
                ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
                usePolling: true,
                interval: 1000
            }
        },
        client: {
            overlay: {
                errors: true,
                warnings: false
            }
        }
    }
});
