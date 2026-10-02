import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { CeluneTestProvider, type CeluneTestProviderProps } from '../testing';

export function renderWithCelune(
  ui: ReactElement,
  props: Omit<CeluneTestProviderProps, 'children'> = {},
) {
  return render(<CeluneTestProvider {...props}>{ui}</CeluneTestProvider>);
}
