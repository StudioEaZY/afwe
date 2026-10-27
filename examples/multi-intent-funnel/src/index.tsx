import React, { useState } from "react";
import { Slide1 } from "./Slide1";
import { Slide2 } from "./Slide2";
import { Slide3 } from "./Slide3";
import { Slide4 } from "./Slide4";
import { Slide5 } from "./Slide5";
import { Slide6 } from "./Slide6";
import { routeCohort } from "./telemetry/abCohort";

export function FunnelApp() {
  const [step, setStep] = useState(1);
  const cohort = routeCohort("anonymous_user");

  return (
    <div className="funnel-container" data-cohort={cohort}>
      {step === 1 && <Slide1 onNext={() => setStep(2)} />}
      {step === 2 && <Slide2 />}
      {step === 3 && <Slide3 />}
      {step === 4 && <Slide4 />}
      {step === 5 && <Slide5 onNext={() => setStep(6)} />}
      {step === 6 && <Slide6 />}
    </div>
  );
}
