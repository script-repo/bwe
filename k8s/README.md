# BWE on Kubernetes - CKA Bootcamp Exercises

This deploys the Big Wheel of Excitement (BWE) as a single-replica Deployment
backed by a PersistentVolumeClaim, with a ConfigMap supplying its default
demo data. It's designed to be spun up in a lab/bootcamp cluster and used to
demonstrate several CKA exam domains hands-on: Storage (PV/PVC/StorageClass),
ConfigMaps, probes, and the practical limits of `ReadWriteOnce` volumes.

## What gets created

| File | Kind | Purpose |
|---|---|---|
| `00-namespace.yaml` | Namespace | `bwe-demo` - keeps everything isolated |
| `01-configmap.yaml` | ConfigMap | Default title/subtitle/names + `PORT` |
| `02-pvc.yaml` | PersistentVolumeClaim | 1Gi, `ReadWriteOnce`, dynamic default StorageClass |
| `03-deployment.yaml` | Deployment | 1 replica, mounts the PVC (`/data`) + ConfigMap (`/config`) |
| `04-service.yaml` | Service | `ClusterIP`, port 80 -> 8080 |
| `bonus/static-pv.yaml` | PV + PVC | Manual/static provisioning exercise (hostPath) |
| `bonus/cronjob-backup.yaml` | CronJob | Backup job sharing the same PVC - RWO discussion prompt |

## 1. Choose the image

The checked-in Deployment is pinned to a public, immutable GHCR image built
and tested by `.github/workflows/publish-image.yml`. You can deploy that image
as-is and skip to the StorageClass check below.

If you changed the application locally, build your own image:

```bash
docker build -t bwe:latest .
```

Then make it available to your cluster (pick the one that matches your setup,
or push to a registry you control and update the `image:` field in
`k8s/03-deployment.yaml`):

```bash
# kind
kind load docker-image bwe:latest

# minikube
minikube image load bwe:latest

# k3d
k3d image import bwe:latest

# real/remote cluster: push to a registry instead
docker tag bwe:latest <your-registry>/bwe:latest
docker push <your-registry>/bwe:latest
# ...then edit k8s/03-deployment.yaml's `image:` field accordingly
```

## 2. Confirm a default StorageClass exists

```bash
kubectl get storageclass
```

You should see one class marked `(default)`. If not, either set one, or add
`storageClassName: <name>` to `k8s/02-pvc.yaml`.

## 3. Deploy

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/
```

Watch it come up:

```bash
kubectl -n bwe-demo get pods,pvc,deploy,svc
kubectl -n bwe-demo describe pvc bwe-data
```

## 4. Open it

```bash
kubectl -n bwe-demo port-forward svc/bwe 8080:80
```

Open <http://localhost:8080>. You should see the wheel pre-loaded with the
Kubernetes-object-themed demo names from `bwe-config`, a trophy icon for run
history, and a small `pod: ... / node: ...` badge in the bottom-left corner.

Spin a few times, add/rename a few entries via the gear icon, and check them
out over the API too:

```bash
curl http://localhost:8080/api/settings
curl http://localhost:8080/api/history
```

## 5. Demo moment #1 - persistence survives pod deletion

```bash
kubectl -n bwe-demo delete pod -l app.kubernetes.io/name=bwe
kubectl -n bwe-demo get pods -w
```

Once the replacement pod is `Running`, reload the page:

- The pod badge shows a **new** pod name (compute is ephemeral).
- Your custom names and run history are **unchanged** (they live on the PVC,
  not in the pod).

## 6. Demo moment #2 - what ReadWriteOnce actually means

```bash
kubectl -n bwe-demo scale deployment/bwe --replicas=2
kubectl -n bwe-demo get pods
kubectl -n bwe-demo describe pod -l app.kubernetes.io/name=bwe
```

`ReadWriteOnce` means the volume may be mounted read-write by pods on **one
node**; it does not mean "one pod." What happens after scaling is therefore a
useful observation exercise rather than a guaranteed failure:

- If both pods land on the same node, both may become `Running` and share the
  PVC. This is the usual result on a single-node kind/minikube cluster.
- If the pods land on different nodes, the second may remain `Pending` with a
  `FailedAttachVolume` or multi-attach event, depending on the CSI driver.

Check `kubectl -n bwe-demo get pods -o wide` and compare each pod's `NODE`
column with the events. For a production multi-replica design, use storage and
an application architecture intended for concurrent access: for example, an
RWX-capable file service where appropriate, or an external database instead
of multiple application processes sharing one SQLite file.

Scale back down before moving on:

```bash
kubectl -n bwe-demo scale deployment/bwe --replicas=1
```

## 7. ConfigMap vs. PVC - what "changing the default data" actually does

```bash
kubectl -n bwe-demo edit configmap bwe-config
```

Change a name in `seed-data.json` and save. Nothing changes in the running
app - the deck was already seeded into the PVC on first boot, and the
ConfigMap is only consulted when the `settings` table is empty. To actually
see the new default deck applied, you'd need a fresh PVC:

```bash
kubectl -n bwe-demo delete deployment bwe
kubectl -n bwe-demo delete pvc bwe-data
kubectl apply -f k8s/02-pvc.yaml -f k8s/03-deployment.yaml
```

This is the core lesson: **ConfigMaps hold declarative, versionable config;
PVCs hold mutable runtime state, and the two don't automatically reconcile.**

## 8. Bonus exercises

- `bonus/static-pv.yaml` - manually bind a PV/PVC pair instead of relying on
  dynamic provisioning (single-node/kind/minikube only, uses `hostPath`).
- `bonus/cronjob-backup.yaml` - a CronJob that mounts the same PVC on a
  schedule; use it to discuss RWO scheduling constraints across pods. It uses
  SQLite's online backup API (via the app image's `better-sqlite3`) rather
  than `cp`: the app runs SQLite in WAL mode, so recent writes live in
  `bwe.db-wal` and a plain file copy of `bwe.db` can silently miss them.

## 9. Cleanup

```bash
kubectl delete -f k8s/bonus/ --ignore-not-found
kubectl delete -f k8s/
```

Note: depending on the StorageClass's reclaim policy, deleting the PVC may or
may not delete the underlying storage - a good moment to check
`kubectl get pv` and look at `RECLAIM POLICY` before and after.
