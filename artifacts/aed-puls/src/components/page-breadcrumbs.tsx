import { Fragment } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { pageBreadcrumbs } from '@/lib/breadcrumbs';
import { useSession } from '@/hooks/use-auth';

export function PageBreadcrumbs() {
  const [location] = useLocation();
  const { user } = useSession();
  const crumbs = pageBreadcrumbs(location).map(crumb=>crumb.href==='/my-submissions'&&user?.role==='PROVIDER'
    ?{...crumb,label:'Zgłoszenia'}:crumb);
  return (
    <div className="border-b bg-background" data-testid="page-breadcrumbs">
      <Breadcrumb aria-label="Ścieżka nawigacji" className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <BreadcrumbList>
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.href}>
              {index > 0 && <BreadcrumbSeparator>/</BreadcrumbSeparator>}
              <BreadcrumbItem className="min-w-0">
                {index === crumbs.length - 1
                  ? <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  : <BreadcrumbLink asChild className="rounded-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <Link href={crumb.href}>{crumb.label}</Link>
                    </BreadcrumbLink>}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
