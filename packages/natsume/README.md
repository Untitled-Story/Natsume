# @untitled-story/natsume

Natsume runs Unity particle effects, animation and Timeline in the browser. It is built on PixiJS v8 and WebGL2 and written in TypeScript.

It loads NOAP (Noa Package) files compiled by [Noa](https://github.com/Untitled-Story/Noa), simulates the scene, and draws it into a Pixi container that the host positions and scales.

```sh
npm install @untitled-story/natsume pixi.js
```

```ts
import { Application, extensions } from 'pixi.js';
import { loadPack, NatsumePlugin } from '@untitled-story/natsume';

extensions.add(NatsumePlugin);

const app = new Application();
await app.init({ preference: 'webgl', preferWebGLVersion: 2 });

const pack = await loadPack('/effects/example.noap');
const effect = await app.natsume.instantiate(pack);
app.stage.addChild(effect.container);
effect.play();
app.ticker.add((ticker) => effect.update(ticker.deltaMS / 1000));
```

Most packs also need environment inputs such as gravity, view position and display size. See the [documentation](https://untitled-story.github.io/Natsume/) for guides, supported features and the API reference, and the [repository](https://github.com/Untitled-Story/Natsume) for development setup.

Licensed under the Apache License 2.0.
