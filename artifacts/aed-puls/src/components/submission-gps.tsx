import { useEffect,useRef } from 'react';
import { Navigation } from 'lucide-react';
import { useCreateSubmissionLocation,type SubmissionLocation } from '@workspace/api-client-react';
import { useGeolocation } from '@/hooks/use-geolocation';
import { errorText } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

export function SubmissionGps({value,onChange}:{value:SubmissionLocation|null;onChange:(v:SubmissionLocation|null)=>void}){
  const geo=useGeolocation(false,0),lookup=useCreateSubmissionLocation(),generation=useRef(0);
  const {mutate}=lookup;
  useEffect(()=>{
    if(geo.status!=='success'||!geo.position||geo.position.accuracy>100)return;
    const request=++generation.current;
    mutate({data:{...geo.position,capturedAt:geo.position.capturedAt??Date.now()}},{
      onSuccess:data=>{if(request===generation.current)onChange(data);},
    });
    return ()=>{generation.current++;};
  },[geo.position,geo.status,mutate,onChange]);
  const busy=geo.status==='loading'||lookup.isPending;
  return <div className="space-y-3 rounded-xl border bg-muted/30 p-4 sm:col-span-2">
    <Button type="button" onClick={()=>{onChange(null);lookup.reset();geo.locate();}} disabled={busy} data-testid="button-send-gps">
      <Navigation className="mr-2 h-4 w-4"/>{busy?'Ustalanie pozycji i adresu…':'Wyślij moją geolokalizację'}
    </Button>
    <p className="text-xs text-muted-foreground">Stań przy zgłaszanym AED. GPS automatycznie uzupełni współrzędne, a Geoapify ustali adres. Tych pól nie można edytować ręcznie.</p>
    <p className="text-xs text-muted-foreground">Po kliknięciu współrzędne zostaną przesłane do Geoapify w celu ustalenia adresu. W zgłoszeniu zapiszemy lokalizację AED, nie historię Twojego ruchu.</p>
    {geo.error&&<p role="alert" className="text-sm text-primary">Nie udało się uzyskać GPS. Włącz dokładną lokalizację w ustawieniach przeglądarki i spróbuj ponownie. W razie blokady podglądu otwórz stronę w osobnej karcie.</p>}
    {geo.position&&geo.status==='success'&&geo.position.accuracy>100&&<p role="alert" className="text-sm text-primary">GPS jest zbyt niedokładny (±{Math.round(geo.position.accuracy)} m). Włącz dokładną lokalizację i spróbuj ponownie przy AED.</p>}
    {lookup.error&&<p role="alert" className="text-sm text-primary">{errorText(lookup.error)}</p>}
    {value&&<div role="status" className="text-sm" data-testid="text-gps-result">
      <p>Pozycja GPS przesłana · dokładność ok. {Math.round(value.accuracy)} m.</p>
      {value.addressStatus==='UNRESOLVED'&&<p className="mt-1 text-muted-foreground">Nie ustalono pełnego adresu. Zachowamy GPS i zgłoszenie jako niekompletne do uzupełnienia przez administratora.</p>}
      <p className="mt-1 text-xs text-muted-foreground">Adres: Geoapify · © współtwórcy OpenStreetMap.</p>
    </div>}
  </div>;
}
