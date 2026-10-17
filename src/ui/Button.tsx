import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

type Variant = 'primary' | 'secondary' | 'quiet' | 'destructive'

interface BaseProps {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  iconRight?: IconName
  loading?: boolean
  block?: boolean
  active?: boolean
  /** 비활성 상태의 이유를 툴팁과 보조 텍스트로 알린다 */
  disabledReason?: string
  children?: ReactNode
  className?: string
}

export type ButtonProps = BaseProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

function cls(p: BaseProps) {
  return [
    'btn',
    `btn-${p.variant ?? 'secondary'}`,
    p.size === 'sm' ? 'btn-sm' : p.size === 'lg' ? 'btn-lg' : '',
    p.block ? 'btn-block' : '',
    p.loading ? 'is-loading' : '',
    p.active ? 'is-active' : '',
    p.className ?? '',
  ].filter(Boolean).join(' ')
}

export function Button({ variant, size, icon, iconRight, loading, block, active, disabledReason, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  const isDisabled = disabled || !!disabledReason
  return (
    <button
      type={type}
      className={cls({ variant, size, icon, loading, block, active, className })}
      disabled={isDisabled || loading}
      aria-busy={loading || undefined}
      title={disabledReason ?? rest.title}
      aria-pressed={active}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} /> : null}
    </button>
  )
}

export function LinkButton({ to, variant, size, icon, iconRight, block, children, className, ...rest }: BaseProps & { to: string; 'aria-label'?: string; onClick?: () => void }) {
  return (
    <Link to={to} className={cls({ variant, size, block, className })} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconRight ? <Icon name={iconRight} /> : null}
    </Link>
  )
}
