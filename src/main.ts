import "./style.css";
import { Animator } from "./core/animator";
import { Helpers } from "./core/helpers";
import { ModelLoader } from "./core/loader";
import { Viewer } from "./core/viewer";
import { initControls } from "./ui/controls";

const canvas = document.getElementById("c") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas element not found.");

const viewer = new Viewer(canvas);
const helpers = new Helpers(viewer.getScene());
const animator = new Animator();
viewer.setOnTick((deltaSeconds) => {
  animator.update(deltaSeconds);
  helpers.update();
});
viewer.start();

const loader = new ModelLoader();
initControls({ viewer, loader, animator, helpers });
