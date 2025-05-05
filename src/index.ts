import { env } from 'cloudflare:workers';
import { Router, IRequest } from 'itty-router';

// Bindings in config:
interface Env {
	IMAGES_ROOT: string,
	IMAGES: ImagesBinding,
	ASSETS: R2Bucket,
}

// TypeScript shenanigans
type CFArgs = [Env, ExecutionContext];
const router = Router<IRequest, CFArgs>();

router.get('/', () => `Hello from images-worker!`);

router.get('/original/sample', async (req: IRequest, env: Env) => {
	const imgPath = `${env.IMAGES_ROOT}/2024-07-12-legally-blonde/DJI_0034.jpg`;
	const imageObject = await env.ASSETS.get(imgPath);

	if (imageObject === null) {
		return new Response(`No object at ${imgPath}`, {status: 404});
	}

	const headers = new Headers();
	imageObject.writeHttpMetadata(headers);
	return new Response(imageObject.body, { headers });
});

router.get('*', () => new Response(null, { status: 404 }));

export default router satisfies ExportedHandler<Env>;
