# Héberger une copie du registre (nœud de niveau 1)

English version: [README.md](README.md)

Un nœud de niveau 1 est une copie complète du registre public QuantumHarmony, sur votre machine, dans votre réseau. Il vérifie chaque bloc et chaque signature qu'il reçoit. Il ne signe rien, ne détient aucune clé qui compte, ne rapporte rien et ne coûte rien de plus que la machine. Sa raison d'être : que le registre ne soit pas gardé par une seule partie. Si une inscription est modifiée quelque part, votre copie cesse de concorder, et `verify.sh` le dit.

## Ce qu'il vous faut

- Une machine, physique ou virtuelle : 4 vCPU, 8 Go de mémoire, disque SSD. La chaîne fait environ 110 Go aujourd'hui et grossit d'environ 1,3 Go par jour ; prévoyez 500 Go.
- Linux avec Docker et Docker Compose v2 (`docker compose version`). Aussi `curl`, `gpg`, `python3`.
- Des connexions sortantes en TCP vers le port 30333 des trois validateurs (51.79.26.123, 51.79.26.168, 209.38.225.4). Aucun port entrant. Aucune modification de pare-feu.
- Une trentaine de minutes, surtout du téléchargement.

## Étapes

```bash
git clone https://github.com/Paraxiom/quantum-harmony-node-public.git
cd quantum-harmony-node-public/level1
NODE_NAME=votre-organisme ./join.sh        # chainspec, instantané signé, démarrage
./verify.sh --status                        # quelques minutes plus tard
```

`join.sh` récupère le chainspec et vérifie son sha256 ainsi que son identifiant de chaîne, récupère la clé de signature de Paraxiom et vérifie son empreinte, télécharge l'instantané et vérifie sa signature GPG et son sha256, le place dans un volume Docker, démarre le nœud, puis vérifie le bloc de genèse que votre nœud a réellement construit. Cette dernière vérification compte : un sha256 conforme prouve seulement que les octets sont ceux attendus, pas qu'ils construisent le réseau que vous vouliez rejoindre. `verify.sh` vérifie d'abord la genèse, puis prend le dernier bloc finalisé de votre nœud et demande à la passerelle publique le haché qu'elle a à la même hauteur. `MATCH` : votre copie concorde avec le réseau. `DIVERGENCE` : elle ne concorde pas à cette hauteur, et c'est un constat qui compte ; gardez les données et écrivez-nous. `WRONG CHAIN` : votre nœud n'est pas sur ce réseau, en général un chainspec périmé ; relancez `join.sh` et signalez-le si cela persiste.

Après un redémarrage ou une mise à jour de l'image : `./join.sh --start`.

## Ce que le nœud fait et ne fait pas

- Il garde une copie complète et vérifie les sceaux de blocs SPHINCS+, les votes de finalité SPHINCS+ et les signatures d'inscription Falcon-512.
- Il ne produit pas de blocs, ne vote pas, n'a ni clé de validateur, ni jeton, ni compte. Il n'y a rien à voler dessus.
- Son RPC répond sur 127.0.0.1:9944 seulement, méthodes sûres seulement. Rien n'est exposé à Internet.
- Il n'écrit aucun renseignement personnel : le registre porte des empreintes de documents avec un court libellé technique, pas les documents.
- Il n'envoie aucune télémétrie.

## État réel du réseau, septembre 2026

Réseau d'essai. Trois validateurs, tous exploités par Paraxiom, plus un nœud de niveau 1 à l'Université Carleton depuis août. Un correctif de finalisation a été déployé le 22 septembre et n'a pas encore été testé de façon indépendante. Un nouveau nœud ne peut pas encore se synchroniser depuis le bloc de genèse, d'où le départ sur un instantané signé. Le transport entre validateurs est classique aujourd'hui ; le relais post-quantique est prévu après le 16 octobre. Six divergences de chaîne sont survenues en 2026, chacune diagnostiquée. Rien de cela ne change ce qu'est un nœud de niveau 1 : une copie vérifiée, et un témoin.

## Niveau 2, plus tard

Un siège de validateur (cosigner les blocs et la finalité) est offert par cohorte une fois l'inscription verrouillée dans la version 46 du runtime et le quatrième validateur en service depuis un trimestre. Héberger un nœud de niveau 1 est le préalable.

## Arrêter, mettre à jour, retirer

```bash
docker compose -f docker-compose.yml down          # arrêter
docker compose -f docker-compose.yml pull && ./join.sh --start   # mettre à jour l'image
docker volume rm level1_qh-level1-data             # effacer les données (irréversible)
```

## Contact

Sylvain Cormier, Paraxiom Technologies inc., sylvain@paraxiom.org, 514 804-8434.
Passerelle publique de lecture utilisée par `verify.sh` : https://validateurs.paraxiom.org/rpc. Page d'état en direct : https://validateurs.paraxiom.org/demo.
