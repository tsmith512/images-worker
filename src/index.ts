import {
	Router,
	IRequest,
	withParams,
	error,
	StatusError,
	json,
	jpeg
} from 'itty-router';

// Bindings in config:
interface Env {
	IMAGES_ROOT: string,
	IMAGES: ImagesBinding,
	ASSETS: R2Bucket,
}

// TypeScript shenanigans
type CFArgs = [Env, ExecutionContext];

// Define the main router to automatically parse parameters and format responses
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

// These methods do the image transformation work. Each accepts an R2 object
// and returns a ReadableStream of the resulting image to include with response.
const variants: {[key: string]: VariantGenerator} = {
	// For consistency, just return the R2ObjectBody's body as a ReadableStream
	"original": async (input, env) => input.body,

	// The "lightbox" content images: resize to 1600 wide
	"full": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({
				width: 1600
			})
			.output({
				format: 'image/jpeg',
				quality: 90,
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
				format: 'image/jpeg',
				quality: 90,
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

	// Square crop
	"sq": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({
				width: 600,
				height: 600,
				fit: 'cover',
			})
			.output({
				format: 'image/jpeg',
				quality: 80,
			});
		return transformation.image();
	},

	// Thumbnail previews for larger previews and retina displays
	"th2x": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({ width: 700 })
			.output({
				format: 'image/jpeg',
				quality: 80,
			});
		return transformation.image();
	},

	// Thumbnail previews
	"th": async (input, env) => {
		const transformation = await env.IMAGES
			.input(input.body)
			.transform({ width: 400 })
			.output({
				format: 'image/jpeg',
				quality: 75,
			});
		return transformation.image();
	},
};

const readableStreamToUint8Array = async (input: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	let chunks = [];

	for await (const chunk of input) {
		chunks.push(chunk);
	}

	let result = new Uint8Array(chunks.length + 1);
	chunks.forEach((v, i) => result.set(v, i));

	return result;
};

// Hello
router.get('/', () => `Hello from images-worker!`);

// Generate a page showing each available variant
router.get('/sheet/:filename+', async (req: IRequest, env: Env) => {
	const filename = req.params.filename;

	let results = [];

	results.push(`<h1>${filename}</h1>`);

	for (const key in variants) {
		if (key == 'original') {
			continue;
		}

		results.push(`
			<h2>${key}</h2>
			<img src='/make/${key}/${filename}' />
		`);
	}

	return new Response(`
		<!DOCTYPE html>
		<html lang="en">
		<head>
				<meta charset="UTF-8" />
				<title>Image Variant Sheet for ${filename}</title>
				<style>
					img { max-width: 100%; height: auto; }
				</style>
		</head>
		<body>
				${results.join('\n')}
		</body>
		</html>
		`, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8'
			},
		}
	);
});

// Generate a specific variant (defined above) of a photo from R2
router.get('/make/:variant/:filename+', async (req: IRequest, env: Env) => {
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

// Generate a specific variant (defined above) of a photo from R2
router.get('/ai/:task/:filename+', async (req: IRequest, env: Env) => {
	const task = req.params.task;
	const filename = req.params.filename;

	const imgPath = `${env.IMAGES_ROOT}/${filename}`;
	const imageObject = await env.ASSETS.get(imgPath);

	if (imageObject === null) {
		throw new StatusError(404, 'Image source not found');
	}

	const transformation = await env.IMAGES
	.input(imageObject.body)
	.transform({ width: 800 })
	.output({
		format: 'image/jpeg',
		quality: 70,
	});

	const response = await env.AI.run(
		// "@cf/unum/uform-gen2-qwen-500m",
		"@cf/microsoft/resnet-50",
		{
			image: [...await readableStreamToUint8Array(transformation.image())],
			// prompt: "Generate accessibility text to describe this photograph.",
			// max_tokens: 512,
		}
	)

	return response;
});

// Anything else is not found
router.get('*', () => error(404));

// Export the router to handle all inbound requests
export default router satisfies ExportedHandler<Env>;
