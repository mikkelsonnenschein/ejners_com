// Full-viewport CRT/NTSC-style image slideshow on a <canvas data-crt-slideshow>.
// Holds each image, crossfades to the next, and layers a constant scanline /
// vignette / grain / chromatic-aberration / tearing "fuzz" that flares up
// around each transition like a CRT briefly losing sync on a cut.

const HOLD_MS = 3200;
const TRANSITION_MS = 1000;
const AFTERGLOW_MS = 350;
const ATTACK_FRACTION = 0.15;
const EASE_BACK_TARGET = 0.82;
const IDLE_FUZZ = 0.15;
const FLASH_AMOUNT = 0.12;
const FLASH_TAU_MS = 45;
const MAX_DPR = 2;

const VERTEX_SHADER = `#version 300 es
out vec2 v_uv;
void main() {
	vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	v_uv = pos;
	gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform vec2 u_resolution;
uniform vec2 u_texASize;
uniform vec2 u_texBSize;
uniform float u_mixProgress;
uniform float u_fuzz;
uniform float u_flash;
uniform float u_time;

in vec2 v_uv;
out vec4 outColor;

vec2 coverUv(vec2 uv, vec2 res, vec2 texSize) {
	float scale = max(res.x / texSize.x, res.y / texSize.y);
	vec2 displaySize = texSize * scale;
	vec2 offset = (displaySize - res) * 0.5;
	vec2 texPixel = uv * res + offset;
	return texPixel / displaySize;
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
	vec2 uv = v_uv;

	// Faint horizontal tearing: a handful of scanline bands jitter
	// sideways, re-rolled a few times a second.
	float bandCount = 90.0;
	float band = floor(uv.y * bandCount);
	float timeBucket = floor(u_time * 6.0);
	float tearSeed = hash(vec2(band, timeBucket));
	float tearActive = step(0.94, hash(vec2(band * 3.1, timeBucket + 11.0)));
	float tearOffset = (tearSeed - 0.5) * 0.012 * u_fuzz * tearActive;
	vec2 tornUv = vec2(uv.x + tearOffset, uv.y);

	// Faint chromatic aberration, stronger toward the edges.
	vec2 center = vec2(0.5);
	float edgeDist = length(tornUv - center);
	float aberration = (0.0022 + edgeDist * 0.0035) * u_fuzz;
	vec2 uvR = tornUv + vec2(aberration, 0.0);
	vec2 uvG = tornUv;
	vec2 uvB = tornUv - vec2(aberration, 0.0);

	vec3 colorA = vec3(
		texture(u_texA, coverUv(uvR, u_resolution, u_texASize)).r,
		texture(u_texA, coverUv(uvG, u_resolution, u_texASize)).g,
		texture(u_texA, coverUv(uvB, u_resolution, u_texASize)).b
	);
	vec3 colorB = vec3(
		texture(u_texB, coverUv(uvR, u_resolution, u_texBSize)).r,
		texture(u_texB, coverUv(uvG, u_resolution, u_texBSize)).g,
		texture(u_texB, coverUv(uvB, u_resolution, u_texBSize)).b
	);

	float mixAmt = smoothstep(0.0, 1.0, u_mixProgress);
	vec3 color = mix(colorA, colorB, mixAmt);

	// Scanlines: always present, deepen slightly during the fuzz peak.
	float scanline = 0.5 + 0.5 * sin(uv.y * u_resolution.y * 1.05);
	float scanlineStrength = 0.10 + 0.12 * u_fuzz;
	color *= 1.0 - scanlineStrength * scanline;

	// Grain: animated per-pixel noise, always present.
	float grain = hash(uv * u_resolution + u_time * 120.0) - 0.5;
	color += grain * (0.035 + 0.09 * u_fuzz);

	// Vignette: constant, subtle.
	float vig = smoothstep(0.9, 0.25, edgeDist);
	color *= mix(0.82, 1.0, vig);

	// Flyback flash: quick faint brightness pop at the start of a cut.
	color += u_flash;

	outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

interface SlideTexture {
	texture: WebGLTexture;
	width: number;
	height: number;
}

interface Uniforms {
	texA: WebGLUniformLocation | null;
	texB: WebGLUniformLocation | null;
	resolution: WebGLUniformLocation | null;
	texASize: WebGLUniformLocation | null;
	texBSize: WebGLUniformLocation | null;
	mixProgress: WebGLUniformLocation | null;
	fuzz: WebGLUniformLocation | null;
	flash: WebGLUniformLocation | null;
	time: WebGLUniformLocation | null;
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp01(x: number): number {
	return Math.min(1, Math.max(0, x));
}

function smoothstep01(t: number): number {
	const x = clamp01(t);
	return x * x * (3 - 2 * x);
}

function easeOutCubic(t: number): number {
	const x = clamp01(t);
	return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t: number): number {
	const x = clamp01(t);
	return x * x * x;
}

function computeFuzz(elapsedSinceTransitionStart: number): number {
	const attackMs = TRANSITION_MS * ATTACK_FRACTION;
	let curve: number;

	if (elapsedSinceTransitionStart <= attackMs) {
		curve = easeOutCubic(elapsedSinceTransitionStart / attackMs);
	} else if (elapsedSinceTransitionStart <= TRANSITION_MS) {
		const t = (elapsedSinceTransitionStart - attackMs) / (TRANSITION_MS - attackMs);
		curve = lerp(1, EASE_BACK_TARGET, smoothstep01(t));
	} else if (elapsedSinceTransitionStart <= TRANSITION_MS + AFTERGLOW_MS) {
		const t = (elapsedSinceTransitionStart - TRANSITION_MS) / AFTERGLOW_MS;
		curve = lerp(EASE_BACK_TARGET, 0, easeInCubic(t));
	} else {
		curve = 0;
	}

	return IDLE_FUZZ + (1 - IDLE_FUZZ) * curve;
}

function computeFlash(elapsedSinceTransitionStart: number): number {
	if (elapsedSinceTransitionStart < 0) return 0;
	return FLASH_AMOUNT * Math.exp(-elapsedSinceTransitionStart / FLASH_TAU_MS);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('Unable to create shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const info = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Shader compile error: ${info ?? 'unknown error'}`);
	}
	return shader;
}

function createProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
	const program = gl.createProgram();
	if (!program) throw new Error('Unable to create program');
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const info = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Program link error: ${info ?? 'unknown error'}`);
	}
	return program;
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.decoding = 'async';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
		img.src = src;
	});
}

function createTexture(gl: WebGL2RenderingContext, img: HTMLImageElement): SlideTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error('Unable to create texture');
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	return { texture, width: img.naturalWidth, height: img.naturalHeight };
}

function drawFrame(
	gl: WebGL2RenderingContext,
	uniforms: Uniforms,
	slideA: SlideTexture,
	slideB: SlideTexture,
	progress: number,
	fuzz: number,
	flash: number,
	timeSeconds: number
): void {
	gl.uniform2f(uniforms.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
	gl.uniform2f(uniforms.texASize, slideA.width, slideA.height);
	gl.uniform2f(uniforms.texBSize, slideB.width, slideB.height);
	gl.uniform1f(uniforms.mixProgress, progress);
	gl.uniform1f(uniforms.fuzz, fuzz);
	gl.uniform1f(uniforms.flash, flash);
	gl.uniform1f(uniforms.time, timeSeconds);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, slideA.texture);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, slideB.texture);

	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

async function initSlideshow(canvas: HTMLCanvasElement): Promise<void> {
	const raw = canvas.dataset.images;
	if (!raw) return;

	let sources: string[];
	try {
		sources = JSON.parse(raw);
	} catch {
		return;
	}
	if (!Array.isArray(sources) || sources.length === 0) return;

	const gl = canvas.getContext('webgl2');
	if (!gl) {
		console.warn('CrtSlideshow: WebGL2 is not supported in this browser.');
		return;
	}
	const glCtx: WebGL2RenderingContext = gl;

	const program = createProgram(glCtx, VERTEX_SHADER, FRAGMENT_SHADER);
	glCtx.useProgram(program);

	const uniforms: Uniforms = {
		texA: glCtx.getUniformLocation(program, 'u_texA'),
		texB: glCtx.getUniformLocation(program, 'u_texB'),
		resolution: glCtx.getUniformLocation(program, 'u_resolution'),
		texASize: glCtx.getUniformLocation(program, 'u_texASize'),
		texBSize: glCtx.getUniformLocation(program, 'u_texBSize'),
		mixProgress: glCtx.getUniformLocation(program, 'u_mixProgress'),
		fuzz: glCtx.getUniformLocation(program, 'u_fuzz'),
		flash: glCtx.getUniformLocation(program, 'u_flash'),
		time: glCtx.getUniformLocation(program, 'u_time'),
	};

	glCtx.uniform1i(uniforms.texA, 0);
	glCtx.uniform1i(uniforms.texB, 1);

	const images = await Promise.all(sources.map(loadImage));
	const slides = images.map((img) => createTexture(glCtx, img));

	const resizeObserver = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (!entry) return;
		const box = entry.devicePixelContentBoxSize?.[0];
		let width: number;
		let height: number;
		if (box) {
			width = box.inlineSize;
			height = box.blockSize;
		} else {
			const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
			const rect = entry.contentRect;
			width = Math.round(rect.width * dpr);
			height = Math.round(rect.height * dpr);
		}
		if (width > 0 && height > 0 && (canvas.width !== width || canvas.height !== height)) {
			canvas.width = width;
			canvas.height = height;
			glCtx.viewport(0, 0, width, height);
		}
	});
	resizeObserver.observe(canvas);

	if (slides.length === 1) {
		const only = slides[0]!;
		const singleTick = (now: number): void => {
			drawFrame(glCtx, uniforms, only, only, 0, IDLE_FUZZ, 0, now / 1000);
			requestAnimationFrame(singleTick);
		};
		requestAnimationFrame(singleTick);
		return;
	}

	let currentIndex = 0;
	let nextIndex = 1;
	let phase: 'hold' | 'transition' = 'hold';
	let phaseStart = performance.now();
	let lastTransitionStart = -Infinity;

	const tick = (now: number): void => {
		const elapsedPhase = now - phaseStart;
		const progress = phase === 'transition' ? Math.min(elapsedPhase / TRANSITION_MS, 1) : 0;

		const fuzzElapsed = now - lastTransitionStart;
		const fuzz = computeFuzz(fuzzElapsed);
		const flash = computeFlash(fuzzElapsed);

		drawFrame(glCtx, uniforms, slides[currentIndex]!, slides[nextIndex]!, progress, fuzz, flash, now / 1000);

		if (phase === 'hold' && elapsedPhase >= HOLD_MS) {
			phase = 'transition';
			phaseStart = now;
			lastTransitionStart = now;
		} else if (phase === 'transition' && progress >= 1) {
			currentIndex = nextIndex;
			nextIndex = (nextIndex + 1) % slides.length;
			phase = 'hold';
			phaseStart = now;
		}

		requestAnimationFrame(tick);
	};

	requestAnimationFrame(tick);
}

const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-crt-slideshow]');
for (const canvas of canvases) {
	initSlideshow(canvas).catch((err) => {
		console.error('CrtSlideshow failed to initialize:', err);
	});
}
