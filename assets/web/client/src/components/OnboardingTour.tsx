import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const STEPS = [
  { title: "Welcome to Custom-PI", body: "Let's get you started in 5 quick steps.", target: null, action: null },
  { title: "Connect an LLM Provider", body: "Go to Settings to add your LLM API key (OpenAI, Anthropic, etc.) so the agent can think and respond.", target: "/settings", action: "Navigate to Settings" },
  { title: "Discover Agents", body: "Explore available agents in Agent Discovery. These are the building blocks for your teams.", target: "/agent-discovery", action: "Go to Agent Discovery" },
  { title: "Run a Swarm", body: "Create a team and launch a swarm in Sub-Agents. Give it a goal and watch it work!", target: "/agents", action: "Go to Sub-Agents" },
  { title: "Customize Your Theme", body: "Make the UI your own in Theme Editor. Choose colors and styles that suit you.", target: "/theme", action: "Go to Theme Editor" },
];

export default function OnboardingTour() {
  const [step, setStep] = useState(-1);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const done = localStorage.getItem("pi-onboarding-done");
      if (done === "true") return;
      const saved = localStorage.getItem("pi-onboarding-step");
      if (saved !== null) setStep(Number(saved));
      else setStep(0);
    } catch { setStep(0); }
  }, []);

  const complete = useCallback(() => {
    try { localStorage.setItem("pi-onboarding-done", "true"); localStorage.removeItem("pi-onboarding-step"); } catch {}
    setStep(-1);
  }, []);

  const go = useCallback((targetStep: number) => {
    if (targetStep >= STEPS.length) { complete(); return; }
    setStep(targetStep);
    try { localStorage.setItem("pi-onboarding-step", String(targetStep)); } catch {}
  }, [complete]);

  const handleAction = useCallback(() => {
    const s = STEPS[step];
    if (!s) return;
    if (s.target) navigate(s.target);
    go(step + 1);
  }, [step, navigate, go]);

  if (step < 0 || step >= STEPS.length) return null;

  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card" role="dialog" aria-label="Onboarding tour">
        <div className="onboarding-steps">
          {STEPS.map((_, i) => (
            <div key={i} className={`onboarding-step-dot ${i === step ? "active" : i < step ? "done" : ""}`} />
          ))}
        </div>
        <div className="onboarding-title">{s.title}</div>
        <div className="onboarding-body">{s.body}</div>
        <div className="onboarding-footer">
          <button className="btn btn-small btn-ghost" onClick={complete} style={{ fontSize: 11 }}>
            Skip tour
          </button>
          <div className="onboarding-footer-right">
            {step > 0 && (
              <button className="btn btn-small btn-ghost" onClick={() => go(step - 1)} style={{ fontSize: 11 }}>
                Back
              </button>
            )}
            {s.action ? (
              <button className="btn btn-small btn-primary" onClick={handleAction} style={{ fontSize: 11 }}>
                {s.action}
              </button>
            ) : (
              <button className="btn btn-small btn-primary" onClick={() => go(step + 1)} style={{ fontSize: 11 }}>
                {isLast ? "Finish" : "Next"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
