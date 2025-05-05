import { AutoRouter } from 'itty-router';

const router = AutoRouter();

router.get('/', () => `Hello from images-worker!`);

export default router satisfies ExportedHandler<Env>;
