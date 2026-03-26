import Phaser from "phaser";
import { EditorBootScene } from "./scenes/EditorBootScene";
import { EditorScene } from "./scenes/EditorScene";

export function createEditorGame(parent: string, width: number, height: number): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width,
    height,
    parent,
    backgroundColor: "#1a1a2e",
    pixelArt: true,
    banner: false,
    disableContextMenu: true,
    scene: [EditorBootScene, EditorScene],
    scale: {
      mode: Phaser.Scale.NONE,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
  };

  return new Phaser.Game(config);
}
