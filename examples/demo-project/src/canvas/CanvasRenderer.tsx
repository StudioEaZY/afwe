export interface RenderInput { title: string; interactive: boolean }

export class CanvasRenderer {
  private frames = 0;
  render(input: RenderInput) {
    this.frames += 1;
    return { type: "canvas", frame: this.frames, ...input };
  }
  reset() {
    this.frames = 0;
  }
}
