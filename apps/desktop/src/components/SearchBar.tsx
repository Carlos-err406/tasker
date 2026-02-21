import { forwardRef } from 'react';
import { cn } from '@/lib/utils.js';
import { Input } from '@/components/ui/input.js';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  ({ value, onChange, className }, ref) => {
    return (
      <Input
        data-testid="search-input"
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) {
              onChange('');
              e.stopPropagation();
            }
          }
        }}
        placeholder="Search all tasks... (&#8984;K)"
        className={cn('h-auto bg-secondary/50 border-border/50 py-1.5 text-sm placeholder:text-muted-foreground/50', className)}
      />
    );
  },
);

SearchBar.displayName = 'SearchBar';
