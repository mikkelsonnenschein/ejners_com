import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) => z.object({
		title: z.string(),
		description: z.string(),
		year: z.string().optional(),
		role: z.string().optional(),
		video: z.string().optional(),
		vimeoID: z.string().optional(),
		still01: image().optional(),
		still02: image().optional(),
		still03: image().optional(),
		still04: image().optional(),
		still05: image().optional(),
		still06: image().optional(),
		externalLink01text: z.string().optional(),
		externalLink01: z.string().optional(),
		externalLink02text: z.string().optional(),
		externalLink02: z.string().optional(),
		externalLink03text: z.string().optional(),
		externalLink03: z.string().optional(),
		ny: z.boolean().optional(),
		upcoming: z.boolean().optional(),
	}),
});

export const collections = { blog };
