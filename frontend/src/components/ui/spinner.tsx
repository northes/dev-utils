import { cn } from '@/lib/utils';
import { SpinnerIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  const { t } = useTranslation();
  return (
    <SpinnerIcon
      data-slot="spinner"
      role="status"
      aria-label={t('common.loading')}
      weight="duotone"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
