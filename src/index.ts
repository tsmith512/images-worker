import { env } from 'cloudflare:workers';
import { Router, IRequest, withParams, error, StatusError, json, jpeg } from 'itty-router';

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
type VariantGenerator = (
	input: R2ObjectBody,
	env: Env
) => Promise<ReadableStream>;

const variants: {[key: string]: VariantGenerator} = {
	// For consistency, just return the R2ObjectBody's body as a ReadableStream
	"original": async (input, env) => input.body,

	// The "lightbox" content images: resize to 1600 wide
	// Load the image, resize it, output as a jpeg, return the ReadableStream to
	// the handler.
	"full": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({
				width: 1600
			})
			.output({
				format: 'image/jpeg'
			});
		return transformation.image();
	},

	// For kicks: watermark the "full"
	"watermarked": async (input, env) => {
		const watermarkImage = await env.ASSETS.get('tsmith-com/watermark.png');

		if (watermarkImage === null) {
			throw new StatusError(500, 'Watermark source not found');
		}

		const transformation = await env.IMAGES
			.input(input.body)
			.transform({
				width: 1600
			})
			.draw(
				env.IMAGES
					.input(watermarkImage.body)
					.transform({ width: 100 }),
				{
					right: 20,
					bottom: 20
				}
			)
			.output({
				format: 'image/jpeg'
			});
		return transformation.image();
	},

	// The photoblog teasers
	"photoblog": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({
				width: 680,
				blur: 4,
			})
			.output({
				format: 'image/jpeg',
				quality: 60,
			});
		return transformation.image();
	},

	// Thumbnail previews
	"700": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({ width: 700 })
			.output({ format: 'image/jpeg' });
		return transformation.image();
	},

	// Thumbnail previews
	"400": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({ width: 400 })
			.output({ format: 'image/jpeg' });
		return transformation.image();
	},
}

router.get('/', () => `Hello from images-worker!`);

router.get('/:variant/:filename+', async (req: IRequest, env: Env) => {
	const variant = req.params.variant;
	const filename = req.params.filename;

	if (!variants.hasOwnProperty(variant)) {
		throw new StatusError(400, 'Requested varinant not defined');
	}

	const imgPath = `${env.IMAGES_ROOT}/${filename}`;
	const imageObject = await env.ASSETS.get(imgPath);

	if (imageObject === null) {
		throw new StatusError(404, 'Image source not found');
	}

	return jpeg(await variants[variant](imageObject, env));
});

router.get('*', () => error(404));

export default router satisfies ExportedHandler<Env>;
