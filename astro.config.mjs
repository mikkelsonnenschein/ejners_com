// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
	site: 'https://mikkelsonnenschein.github.io',
	base: process.env.NODE_ENV === 'production' ? '/ejners_com/' : '/',
	integrations: [mdx(), sitemap()],
  });
