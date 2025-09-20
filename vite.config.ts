import path from 'path';
import react from '@vitejs/plugin-react-swc';
import tailwindcss from '@tailwindcss/vite';

export default () => {
	return {
		plugins: [react(), tailwindcss()].filter(Boolean),
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src'),
			},
		},
		build: {
			outDir: 'dist-temp',
			sourcemap: false,
			minify: true,
		},
	};
};
