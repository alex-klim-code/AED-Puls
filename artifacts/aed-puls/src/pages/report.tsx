import { useEffect,useMemo,useState,type FormEvent } from 'react';
import { Link,useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2,Navigation } from 'lucide-react';
import { getGetAedQueryKey,getListConflictReportsQueryKey,getListMapPointsQueryKey,useCreateReport,useGetAed,useListMapPoints } from '@workspace/api-client-react';
import { SiteLayout } from '@/components/layout';
import { AedMap } from '@/components/aed-map';
import { EmergencyNotice,VerificationBadge } from '@/components/aed-bits';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorText, useSession } from '@/hooks/use-auth';
import { PhotoPicker } from '@/components/proposals/photo-upload';
import { useGeolocation } from '@/hooks/use-geolocation';
import { distanceMeters,type Coordinates } from '@/lib/geo';

export default function ReportPage(){
  const {user,isLoading}=useSession();
  if(isLoading)return <SiteLayout><div className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><div className="h-64 animate-pulse rounded-2xl bg-muted"/></div></SiteLayout>;
  if(!user)return <Gate title="Zgłoszenie błędu wymaga zalogowania" text="Dzięki temu administrator może odpowiedzieć na zgłoszenie, a Ty śledzisz jego status i rozmowę w swoich zgłoszeniach." href="/login" cta="Zaloguj się" testId="link-report-login"/>;
  if(user.role==='ADMIN')return <Gate title="Administrator nie tworzy zgłoszeń" text="Zgłoszenia błędów pochodzą od użytkowników i organizacji. Jako administrator rozpatrujesz je w kolejce: poprawiasz rekord (DONE) albo odrzucasz zgłoszenie (REJECTED)." href="/admin/reports" cta="Przejdź do zgłoszeń błędów" testId="link-report-admin-queue"/>;
  return <ReportForm/>;
}

function Gate({title,text,href,cta,testId}:{title:string;text:string;href:string;cta:string;testId:string}){
  return <SiteLayout><div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
    <section className="rounded-2xl border bg-card p-8 sm:p-10">
      <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Zgłoszenie błędu</p>
      <h1 className="mt-2 font-display text-3xl font-bold">{title}</h1>
      <p className="mt-3 text-muted-foreground">{text}</p>
      <Button asChild className="mt-6"><Link href={href} data-testid={testId}>{cta}</Link></Button>
    </section>
    <EmergencyNotice className="mt-6"/>
  </div></SiteLayout>;
}

function ReportForm(){
  const [photoId,setPhotoId]=useState<string|null>(null),[uploading,setUploading]=useState(false),[photoKey,setPhotoKey]=useState(0);
  const initial=new URLSearchParams(useSearch()).get('aedId')??'';
  const [aedId,setAedId]=useState(initial),[drafts,setDrafts]=useState<Record<string,string>>({}),[done,setDone]=useState<string|null>(null);
  const [center,setCenter]=useState<Coordinates>({latitude:52.07,longitude:19.48});
  const geo=useGeolocation(true),report=useCreateReport(),qc=useQueryClient();
  const params={limit:20000};
  const points=useListMapPoints(params,{query:{queryKey:getListMapPointsQueryKey(params),staleTime:60000}});
  const id=aedId.trim(),message=drafts[id]??'';
  const aed=useGetAed(id,{query:{enabled:/^[0-9a-f-]{36}$/i.test(id),queryKey:getGetAedQueryKey(id),retry:false}});
  useEffect(()=>{if(initial)setAedId(initial);},[initial]);
  const area=useMemo(()=>{
    const rows=(points.data??[]).filter(p=>distanceMeters(center,p)<=5000);
    return rows.sort((a,b)=>distanceMeters(center,a)-distanceMeters(center,b));
  },[points.data,center]);
  const selected=aed.data;
  const reportable=selected&&selected.id===id&&!selected.isDemo&&(
    ['VERIFIED','verified'].includes(selected.verificationStatus)||
    (selected.imported&&selected.publicImport&&['NOT_VERIFIED','unverified','pending'].includes(selected.verificationStatus))
  );
  const shown=useMemo(()=>{
    if(reportable&&selected&&selected.latitude!==null&&selected.longitude!==null&&!area.some(p=>p.id===selected.id))return [...area,selected];
    return area;
  },[area,selected,reportable]);
  const pick=(next:string)=>{
    if(report.isPending)return;
    setAedId(next);setDone(null);report.reset();
  };
  const submit=(e:FormEvent)=>{
    e.preventDefault();
    if(!reportable||!selected||message.trim().length<10||report.isPending||uploading)return;
    const target=id;
    report.mutate({data:{aedId:target,message:message.trim(),...(photoId?{photoId}:{})}},{onSuccess:()=>{setDone(target);setPhotoId(null);setPhotoKey(k=>k+1);qc.invalidateQueries({queryKey:getListConflictReportsQueryKey()});}});
  };
  return <SiteLayout>
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="font-data text-xs uppercase tracking-[0.2em] text-primary">Zgłoszenie błędu</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Wybierz AED na mapie i opisz problem</h1>
        <p className="mt-2 text-sm text-muted-foreground">Mapa pokaże Twoje otoczenie po uzyskaniu zgody na GPS. Zgłoszenie nie zmienia danych AED automatycznie.</p>
      </div>
      {done?<section role="status" className="rounded-2xl border bg-card p-6">
        <CheckCircle2 className="h-9 w-9 text-verified" aria-hidden/>
        <h2 className="mt-3 font-display text-2xl font-bold">Zgłoszenie przyjęte przez serwer</h2>
        <p className="mt-2 text-muted-foreground">Dziękujemy. Informacja została zapisana do sprawdzenia.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild><Link href={`/aed/${done}`}>Wróć do rekordu</Link></Button>
          <Button asChild variant="outline"><Link href="/my-submissions">Moje zgłoszenia</Link></Button>
          <Button variant="outline" onClick={()=>{setDrafts(d=>({...d,[done]:''}));setDone(null);}}>Nowe zgłoszenie</Button>
        </div>
      </section>:<div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <section className="min-w-0 space-y-3" aria-label="Wybór AED na mapie">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">1. Wybierz AED</h2>
            <Button type="button" variant="outline" onClick={geo.locate} disabled={geo.status==='loading'} data-testid="button-report-gps">
              <Navigation className="mr-2 h-4 w-4"/>{geo.status==='loading'?'Ustalanie pozycji…':'Użyj mojej lokalizacji'}
            </Button>
          </div>
          {geo.error&&<p role="alert" className="text-sm text-primary">Nie uzyskano lokalizacji. Zezwól na GPS w przeglądarce albo przesuń mapę i wybierz AED. Jeśli podgląd blokuje GPS, otwórz stronę w osobnej karcie.</p>}
          <AedMap aeds={shown} selectedId={id} onSelect={pick} userPosition={geo.position} onCenterChange={setCenter} preserveView className="h-[360px] overflow-hidden rounded-2xl border sm:h-[420px]" label="Mapa wyboru AED do zgłoszenia błędu"/>
          <p className="text-xs text-muted-foreground">{points.isLoading?'Wczytywanie AED…':points.error?'Nie udało się pobrać AED.':`AED w promieniu 5 km od środka mapy: ${area.length}. Kliknij znacznik, aby wybrać urządzenie.`}</p>
          {points.error&&<Button variant="outline" onClick={()=>points.refetch()}>Ponów pobieranie AED</Button>}
          <div className="grid gap-2 sm:grid-cols-2" aria-label="AED w bieżącym obszarze">
            {area.slice(0,6).map(p=><button key={p.id} type="button" disabled={report.isPending} onClick={()=>pick(p.id)}
              aria-pressed={id===p.id} className={`rounded-xl border p-3 text-left text-sm ${id===p.id?'border-primary bg-accent':'bg-card hover:border-foreground'}`} data-testid={`button-select-aed-${p.id}`}>
              <span className="block font-semibold">{p.name||'AED — brak nazwy w źródle'}</span><span className="text-xs text-muted-foreground">{p.city||'Wybierz punkt i sprawdź szczegóły'}</span>
            </button>)}
          </div>
        </section>
        <form onSubmit={submit} className="self-start space-y-5 rounded-2xl border bg-card p-5 sm:p-6" noValidate>
          <h2 className="font-semibold">2. Opisz, co jest nie tak</h2>
          <div aria-live="polite" className="rounded-xl bg-muted p-3 text-sm" data-testid="text-selected-report-aed">
            {!id?'Wybierz urządzenie, klikając punkt na mapie.':aed.isLoading?'Pobieranie szczegółów AED…':!reportable?'Wybrany rekord nie jest dostępny do zgłoszenia. Wybierz publiczne AED na mapie.':selected?<>
              <p className="font-semibold">{selected.name||'AED — brak nazwy w źródle'}</p>
              <p className="mt-1">{[selected.address,selected.city].filter(Boolean).join(', ')||'Brak adresu w źródle'}</p>
              <div className="mt-2"><VerificationBadge status={selected.verificationStatus}/></div>
            </>:'Nie udało się odczytać wybranego AED. Wybierz punkt na mapie.'}
          </div>
          <div>
            <Label htmlFor="msg">Co jest nieprawidłowe?</Label>
            <Textarea id="msg" rows={6} value={message} onChange={e=>setDrafts(d=>({...d,[id]:e.target.value}))} disabled={!reportable||report.isPending}
              maxLength={2000} className="mt-2" placeholder="Np. urządzenie przeniesiono do holu głównego, wejście od ul. Długiej." aria-describedby="msg-hint" data-testid="input-message"/>
            <p id="msg-hint" className="mt-1 text-xs text-muted-foreground">Minimum 10 znaków · {message.length}/2000. Nie podawaj danych osobowych.</p>
          </div>
          <PhotoPicker key={photoKey} onChange={setPhotoId} onBusy={setUploading} disabled={!reportable||report.isPending} label="Zdjęcie (opcjonalnie)" testId="report-photo"/>
          {report.error&&<p role="alert" className="rounded-xl border border-primary/30 p-3 text-sm text-primary">{errorText(report.error)}</p>}
          <Button type="submit" size="lg" disabled={!reportable||message.trim().length<10||report.isPending||uploading} className="w-full" data-testid="button-submit-report">
            {report.isPending?'Wysyłanie…':'Wyślij zgłoszenie'}
          </Button>
          <p className="text-xs text-muted-foreground">Nie musisz przepisywać identyfikatora AED. Status i rozmowę z administratorem znajdziesz w swoich zgłoszeniach.</p>
        </form>
      </div>}
      <EmergencyNotice/>
    </div>
  </SiteLayout>;
}
