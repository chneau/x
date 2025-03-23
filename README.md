```bash
apt update
apt install -y curl git unzip sudo
useradd c -mG sudo
echo "c ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/c
su c
# then
curl -fsSL https://bun.sh/install | bash
curl -fsSL raw.githubusercontent.com/chneau/dotfiles/master/bootstrap.sh | sh
bash
bun install -fg @chneau/x
# fix all then
x doctor
zsh

# you can deploy service to a kube cluster now
x deploy

# TODO: add a magic env var that tells the current git comit short hash for tagging and usage on the deploy file
# TODO: make the image name the service name if not provided
# TODO: if the repository or image or service is single - make it the default for all above
# TODO: understand how to remove the 1sec of downtime on the deploy - look at kubernetes documentation
# TODO: Make kubeconfig file optional - default to the one kubectl uses
# TODO: Make the repository username/password optional - the user might already be logged in or the repository might be public
```
