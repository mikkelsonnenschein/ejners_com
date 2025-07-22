import { glob } from 'astro/loaders';
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) => z.object({
		title: z.string(),
		year: z.string(),
		role: z.string(),
		video: z.string(),
		still01: image().optional(),
		still02: image().optional(),
		still03: image().optional(),
		externalLink01text: z.string(),
		externalLink01: z.string(),
		externalLink02text: z.string(),
		externalLink02: z.string(),
		externalLink03text: z.string(),
		externalLink03: z.string(),
		featured: z.boolean(),
	}),
});

export const collections = { blog };
