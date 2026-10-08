import React, { useState } from "react";
import { Slide1 } from "./Slide1";
import { Slide5 } from "./Slide5";
import { Slide6 } from "./Slide6";

export function FunnelApp() {
  const [step, setStep] = useState(1);

  return (
    <div className="funnel-container">
      {step === 1 && <Slide1 onNext={() => setStep(5)} />}
      {step === 5 && <Slide5 onNext={() => setStep(6)} />}
      {step === 6 && <Slide6 />}
    </div>
  );
}
