'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

const STEPS = [
  'Creating your Getting Started project...',
  'Building 8 interactive tutorial tasks...',
  'Analyzing your goals and priorities...',
  'Generating your personalized project...',
  'Setting up your workspace...',
];

interface GenerationLoadingProps {
  agentName: string;
  agentColor: string;
  /** Signal that the API call has finished; remaining steps will fast-forward. */
  isComplete?: boolean;
  /** Called after the final step finishes its brief display. */
  onStepsFinished?: () => void;
}

export function GenerationLoading({
  agentName,
  agentColor,
  isComplete = false,
  onStepsFinished,
}: GenerationLoadingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [allDone, setAllDone] = useState(false);

  // Normal cadence: advance one step every 2.5s
  useEffect(() => {
    if (isComplete) return; // fast-forward effect takes over
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < STEPS.length - 1) {
          setCompletedSteps((c) => [...c, prev]);
          return prev + 1;
        }
        return prev;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [isComplete]);

  // Fast-forward: when API signals completion, rush through remaining steps
  useEffect(() => {
    if (!isComplete || allDone) return;

    const fastForward = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < STEPS.length - 1) {
          setCompletedSteps((c) => [...c, prev]);
          return prev + 1;
        }
        // Mark the last step complete and signal parent
        setCompletedSteps((c) => (c.includes(prev) ? c : [...c, prev]));
        setAllDone(true);
        return prev;
      });
    }, 300);

    return () => clearInterval(fastForward);
  }, [isComplete, allDone]);

  // Notify parent after all steps are visually done
  useEffect(() => {
    if (!allDone) return;
    const timeout = setTimeout(() => onStepsFinished?.(), 400);
    return () => clearTimeout(timeout);
  }, [allDone, onStepsFinished]);

  const initials = agentName.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col items-center px-8 py-16">
      {/* Animated avatar */}
      <div
        className="mb-8 flex h-20 w-20 animate-pulse items-center justify-center rounded-full text-xl font-bold text-white"
        style={{ backgroundColor: agentColor }}
      >
        {initials}
      </div>

      <h2 className="text-foreground mb-2 text-lg font-semibold">
        {agentName} is setting things up
      </h2>
      <p className="text-muted-foreground mb-8 text-sm">This usually takes a few seconds</p>

      {/* Step list */}
      <div className="w-full max-w-sm space-y-3">
        {STEPS.map((step, i) => {
          const isStepComplete = completedSteps.includes(i);
          const isCurrent = i === currentStep;

          return (
            <div
              key={i}
              className={`flex items-center gap-3 transition-opacity ${
                i > currentStep ? 'opacity-30' : 'opacity-100'
              }`}
            >
              {isStepComplete ? (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-500" />
              ) : isCurrent ? (
                <Loader2 className="text-brand h-4 w-4 flex-shrink-0 animate-spin" />
              ) : (
                <div className="bg-surface-300 h-4 w-4 flex-shrink-0 rounded-full" />
              )}
              <span
                className={`text-sm ${isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
              >
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
