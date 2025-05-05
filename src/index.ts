import { env } from 'cloudflare:workers';
import { Router, IRequest, withParams, error, StatusError, json } from 'itty-router';

// Bindings in config:
interface Env {
	IMAGES_ROOT: string,
	IMAGES: ImagesBinding,
	ASSETS: R2Bucket,
}

// TypeScript shenanigans
type CFArgs = [Env, ExecutionContext];
const router = Router<IRequest, CFArgs>({
	before: [withParams],
	catch: error,
	finally: [json]
});

// Image Variants
const variants = {
	"original": {},
}

router.get('/', () => `Hello from images-worker!`);

router.get('/:variant/sample', async (req: IRequest, env: Env) => {
	const variant = req.params.variant;

	if (!variants.hasOwnProperty(variant)) {
		throw new StatusError(400, 'Requested varinant not defined');
	}

	const imgPath = `${env.IMAGES_ROOT}/2024-07-12-legally-blonde/DJI_0034.jpg`;
	const imageObject = await env.ASSETS.get(imgPath);

	if (imageObject === null) {
		throw new StatusError(404, 'Image source not found');
	}

	const headers = new Headers();
	imageObject.writeHttpMetadata(headers);
	return new Response(imageObject.body, { headers });
});

router.get('*', () => error(404));

export default router satisfies ExportedHandler<Env>;
