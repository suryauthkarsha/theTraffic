import { KnotAnimation } from "@/components/ui/knot-animation";

/** Reference usage: a grayscale knot centred in the viewport. The landing page uses the coloured form. */
const DemoOne = () => {
  return (
    <div className="flex w-full h-screen justify-center items-center">
      <KnotAnimation />
    </div>
  );
};

export { DemoOne };
