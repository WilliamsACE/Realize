/* Expresiones de varias palabras que se detectan al preparar una lectura:
   phrasal verbs y modismos cuyo significado no se deduce de sus palabras
   (las palabras sueltas suelen ser comunes y la lista NGSL las descarta).

   Formato: una expresión por línea, en su forma de diccionario.
   - La primera palabra se reconoce conjugada: "kick off" → kicked off, kicks off…
   - Un phrasal verb de dos palabras también se reconoce separado por un objeto
     corto: "put it off", "turned the offer down".
   - "one's" acepta cualquier posesivo: "make up one's mind" → made up her mind.
   - "$" al final: solo cuenta si la expresión cierra la frase (antes de un signo
     de puntuación o al final), para no confundir "to boot" con "to boot the computer".
   Las líneas que empiezan con # son comentarios. */
window.PHRASES_RAW = `
# --- con "off" ---
back off
bite off
block off
blow off
break off
brush off
buy off
call off
carry off
cast off
cool off
cordon off
cut off
doze off
drift off
drop off
ease off
fend off
fight off
finish off
fire off
fob off
go off
head off
hit it off
hold off
kick off
kill off
knock off
laugh off
lay off
let off
level off
live off
make off
nod off
pass off
pay off
peel off
polish off
pull off
put off
rattle off
reel off
rip off
round off
rub off
seal off
see off
sell off
send off
set off
shake off
show off
shrug off
shut off
sign off
sound off
square off
stave off
storm off
take off
tail off
tell off
tick off
tip off
top off
trail off
wander off
ward off
wear off
work off
write off
off the record
off the cuff
off the hook
off the top of one's head
off the beaten track
off the beaten path
off the mark
off the wall
off guard
off balance
off limits
off-putting
on and off
off and on
better off
well off
# --- otros phrasal verbs frecuentes ---
act up
back down
back up
bail out
black out
blow up
boil down to
bottle up
break down
break in
break out
break up
bring about
bring up
brush up on
bump into
burn out
butt in
call for
call on
calm down
carry on
carry out
catch on
catch up
catch up with
cheer up
chip in
clam up
clear up
come about
come across
come along
come by
come down with
come in handy
come off
come round
come through
come up
come up against
come up with
count on
crack down on
crack up
cut back
cut down on
cut in
dawn on
die down
dig in
do away with
do without
drag on
draw up
dress up
drop by
drop out
dwell on
end up
face up to
fall apart
fall back on
fall behind
fall for
fall out
fall through
figure out
fill in
find out
fit in
follow through
follow up
freak out
get across
get along
get along with
get around
get away with
get by
get down to
get on with
get over
get round to
get through
give away
give in
give out
give up
go ahead
go along with
go for
go over
go through
go without
grow on
hand in
hand out
hang on
hang out
hang up
hold back
hold on
hold out
hold up
hush up
iron out
jot down
keep up
keep up with
lash out
lay down
leave out
let down
lighten up
live up to
look after
look down on
look forward to
look into
look up to
loosen up
make out
make up
make up for
mess up
mix up
own up to
pan out
pass away
pass out
patch up
pick on
pick up
pin down
play down
point out
pull over
pull through
put away
put down
put forward
put out
put up with
rule out
run into
run out of
run over
run up against
scrape by
see through
set about
set up
settle down
settle for
show up
shut up
single out
size up
slip up
sort out
speak up
stand by
stand for
stand out
stand up for
step down
stick around
stick out
stick up for
sum up
take after
take in
take on
take over
take up
talk down to
tear up
think over
throw up
tidy up
track down
try out
turn down
turn in
turn out
turn up
wear out
wind up
wipe out
work out
wrap up
zone out
# --- modismos y expresiones fijas ---
to boot$
for good$
after all$
all along
all of a sudden
as a matter of fact
as it were
at a loss
at heart
at large
at length
at odds
at stake
at the drop of a hat
a blessing in disguise
a piece of cake
back to square one
beat around the bush
behind the scenes
bite the bullet
break the ice
by and large
by heart
by the skin of one's teeth
call it a day
come to terms with
cut corners
cut to the chase
every now and then
few and far between
for the time being
get cold feet
get rid of
give the benefit of the doubt
go the extra mile
hang in there
have a soft spot for
hit the hay
hit the nail on the head
hit the sack
in a nutshell
in hindsight
in the long run
in the nick of time
in vain
keep an eye on
keep in mind
let alone
let the cat out of the bag
make ends meet
make up one's mind
miss the boat
needless to say
no wonder
on edge
on the fence
on the verge of
once in a blue moon
out of hand
out of the blue
out of the question
pull one's leg
see eye to eye
so to speak
sooner or later
spill the beans
take for granted
the last straw
to and fro
under the weather
up in the air
`;
