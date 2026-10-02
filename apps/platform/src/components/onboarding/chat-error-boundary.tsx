'use client';

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@repo/ui/components/button';

interface Props {
  children: ReactNode;
  onSkip?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for the onboarding chat streaming UI.
 * Catches render errors and streaming failures, shows a friendly
 * recovery UI with retry and skip options.
 */
export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[onboarding-chat] Error boundary caught:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-white">Something went wrong</h3>
            <p className="text-sm leading-relaxed text-white/50">
              The conversation hit an unexpected error. You can retry or skip this step and set up
              your profile later.
            </p>
          </div>
          <div className="flex gap-3">
            {this.props.onSkip && (
              <Button
                variant="outline"
                onClick={this.props.onSkip}
                className="border-white/10 text-white/60 hover:bg-white/5 hover:text-white"
              >
                Skip for now
              </Button>
            )}
            <Button onClick={this.handleRetry} className="gap-2 text-black">
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
