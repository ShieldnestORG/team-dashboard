import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { youtubeApi } from "../../api/youtube";
import {
  checkYoutubeText,
  finalYoutubeDescription,
  utf8Bytes,
  youtubeHashtags,
} from "./youtube-final-text";

export function EditVideoTextDialog({
  open,
  onOpenChange,
  id,
  title,
  description,
  tags,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id: string;
  title: string;
  description: string;
  tags: string[];
  onSaved: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description);
  const [serverError, setServerError] = useState<string | null>(null);

  // Re-seed the draft each time the dialog opens with the card's live values.
  useEffect(() => {
    if (open) {
      setDraftTitle(title);
      setDraftDescription(description);
      setServerError(null);
    }
  }, [open, title, description]);

  const save = useMutation({
    mutationFn: () => {
      // Send ONLY the fields that changed.
      const body: { title?: string; description?: string } = {};
      if (draftTitle !== title) body.title = draftTitle;
      if (draftDescription !== description) body.description = draftDescription;
      return youtubeApi.editQueueItem(id, body);
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: unknown) =>
      setServerError(
        err instanceof Error
          ? err.message
          : "That did not save. Nothing was changed. Try again.",
      ),
  });

  const titleChanged = draftTitle !== title;
  const descriptionChanged = draftDescription !== description;
  const nothingChanged = !titleChanged && !descriptionChanged;

  // Judge only the fields being changed, exactly as the server does, so a
  // title-only edit is never refused for a description it did not touch.
  const validationError = checkYoutubeText({
    title: titleChanged ? draftTitle : undefined,
    description: descriptionChanged ? draftDescription : undefined,
    tags,
  });

  const hashtags = youtubeHashtags(tags);
  const finalDescription = finalYoutubeDescription(draftDescription, hashtags);
  const finalBytes = utf8Bytes(finalDescription);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit title and description</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="yt-edit-title">Title</Label>
            <Input
              id="yt-edit-title"
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value);
                setServerError(null);
              }}
            />
            <p className="text-right text-xs text-muted-foreground">
              {draftTitle.length} / 100
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="yt-edit-description">Description</Label>
            <Textarea
              id="yt-edit-description"
              rows={8}
              className="max-h-56 overflow-y-auto"
              value={draftDescription}
              onChange={(e) => {
                setDraftDescription(e.target.value);
                setServerError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Keep the lines that start with a time. They are the chapter list.
            </p>
            <p className="text-right text-xs text-muted-foreground">
              {finalBytes.toLocaleString("en-US")} / 5,000 bytes
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Exactly what will go on YouTube</p>
            <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/50 p-3">
              <p className="whitespace-pre-wrap break-words text-sm font-semibold">
                {draftTitle}
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {finalDescription}
              </p>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Tags cannot be changed here yet.
              </p>
            </div>
          )}
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}

        <DialogFooter className="sm:items-center">
          {validationError && (
            <p className="text-sm text-destructive sm:mr-auto">{validationError}</p>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            disabled={Boolean(validationError) || nothingChanged || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
