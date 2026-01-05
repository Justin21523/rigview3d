import "./style.css";
import { Helpers } from "./core/helpers";
import { Viewer } from "./core/viewer";
import { initControls } from "./ui/controls";

const canvas = document.getElementById("c") as HTMLCanvasElement | null;
if (!canvas) throw new Error("Canvas element not found.");

const viewer = new Viewer(canvas);
new Helpers(viewer.getScene());
viewer.start();

initControls({ viewer });
