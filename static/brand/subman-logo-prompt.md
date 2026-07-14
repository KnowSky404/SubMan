# SubMan Logo Generation Prompt

## Final prompt

Use case: logo-brand
Asset type: master brand mark for a GitHub Primer-inspired proxy subscription management web application, later used in the app header and as the source for favicon sizes
Primary request: Create a distinctive, compact symbol for "SubMan", a developer tool that collects proxy nodes and subscriptions, synchronizes them through a GitHub Gist workspace, and publishes one aggregated output.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for background removal; one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation
Subject: one centered standalone symbol; form an unmistakable abstract capital S from exactly one continuous thick routing path; attach one circular node directly to each end of the path, for exactly two endpoint nodes total; place one short emerald green connector segment across the narrow center of the S to suggest aggregation and sync; every shape must touch the main path and the mark must read as an S first and a network second
Style/medium: flat vector-style geometric logo, precise monoline-to-solid construction, restrained developer-tool identity, compatible with GitHub Primer UI, polished production icon rather than an illustration
Composition/framing: square canvas, symbol centered, symmetrical visual weight, generous 18 percent safe-area padding, no enclosing app-tile square, no border touching the canvas, recognizable at 16 px
Color palette: one perfectly flat GitHub accent blue #0969da fill for the path and endpoint nodes, one perfectly flat emerald green #1f883d fill for the short central connector segment; no other subject colors and do not use #ff00ff in the subject
Materials/textures: completely flat color fills, crisp edges, no texture
Text: none
Constraints: transparent-ready silhouette after chroma-key removal; exactly one continuous S path, exactly two attached endpoint circles, and exactly one attached green center segment; no detached or floating shapes; high contrast on both white #ffffff and near-black #0d1117 backgrounds; avoid tiny gaps, holes, internal white circles, and hairline details; original mark with no resemblance to third-party logos or trademarks
Avoid: detached circles, floating nodes, internal white circles, extra endpoints, extra paths, letters other than the abstract S form, wordmarks, GitHub Octocat, chain-link cliches, shields, clouds, globes, arrows, speed lines, superhero imagery, people, mascots, gradients, color variation within a fill, 3D, bevels, glass, glow, drop shadows, mockups, rounded-square app icon backgrounds, watermark, signature

## Asset derivation

1. Remove the flat #ff00ff background from the generated master.
2. Crop to the visible mark and restore square transparent padding.
3. Export the transparent master as `subman-logo.png`.
4. Derive `favicon-32.png`, `favicon-192.png`, and `apple-touch-icon.png` from the same master with high-quality downsampling.

## Design rationale

- The S-shaped flow makes the project name visible without relying on a wordmark.
- Two attached endpoints represent input and output; the central connector represents aggregation.
- Blue aligns with Primer's primary accent while green connects to successful synchronization and publishing states.
- A compact silhouette and limited detail preserve recognition at favicon size.
