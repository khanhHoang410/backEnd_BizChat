const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY.trim(), // trim() phòng trường hợp có space
);

// Folder structure:
// bizchat-files/private/userId_A__userId_B/filename
// bizchat-files/groups/groupId/filename

const uploadFileToSupabase = async ({ buffer, mimetype, originalname, receiverId, groupId, uploadedBy }) => {
  const ext = originalname.split('.').pop();
  const filename = `${Date.now()}_${originalname}`;

  // Xác định folder
  let folder = '';
  if (groupId) {
    folder = `groups/${groupId}`;
  } else if (receiverId) {
    // Sort để folder luôn giống nhau dù ai gửi trước
    const ids = [uploadedBy, receiverId].sort();
    folder = `private/${ids[0]}__${ids[1]}`;
  }

  const path = `${folder}/${filename}`;

  const { data, error } = await supabase.storage
    .from('bizchat-files')
    .upload(path, buffer, {
      contentType: mimetype,
      upsert: false,
    });

  if (error) throw error;

  // Lấy public URL
  const { data: urlData } = supabase.storage
    .from('bizchat-files')
    .getPublicUrl(path);

  return {
    url: urlData.publicUrl,
    path,
    name: originalname,
    size: buffer.length,
  };
};

module.exports = { supabase, uploadFileToSupabase };
