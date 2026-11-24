# Credits

The graveyard scene uses no third-party models, textures, fonts or sounds: every shape, texture and effect is made in code (procedural geometry and GLSL), and the text uses the browser's own monospace font, so there is nothing to credit. The sound (off until you turn it on) is made the same way: every cricket, owl, shovel, wail and rumble is generated with the Web Audio API from oscillators and noise (`frontend/src/sound/engine.ts`), with no audio file and no recording.

## The landing page and brand

- **Creepster** by Font Diner (Copyright © 2011 Font Diner, Inc), SIL Open Font License 1.1. Used only for the "Repo In Peace" title on the landing page and the social image. Self-hosted: `frontend/public/fonts/creepster/Creepster-Regular.woff2`, with the licence in `OFL.txt` beside it.
- The logo, the small mark, the favicons and the landing page's night are our own drawings (`frontend/scripts/make-brand.mjs`, `frontend/src/ui/Landing.tsx`). "FSN" on the logo is plain carved text in the same serif as the rest of the inscription; no SGI logo, motif, colours or lettering is used.
