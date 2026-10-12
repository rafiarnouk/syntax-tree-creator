import "./style.css";
import { TreeEditor } from "./editor";

const root = document.querySelector<HTMLElement>(".app");
if (root) new TreeEditor(root);
