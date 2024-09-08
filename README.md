```bash
apt update
apt install -y curl git unzip sudo
useradd c -mG sudo
echo "c ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/c
su c
# then
curl -fsSL https://bun.sh/install | bash
~/.bun/bin/bun x @chneau/x system
~/.bun/bin/bun x @chneau/x doctor
~/.bun/bin/bun x @chneau/x update
```
